import {
  validateQuestionAnswer,
  type Interaction,
  type InteractionAnswer,
  type TimelineEvent,
  type TimelineState,
} from '@skaro/timeline';
import type { AppDb } from '@skaro/core';
import { randomUUID } from 'node:crypto';
import { coordinationHash } from './project-coordinator-request';
import { withoutSecrets } from './session-log';
import { queueOwnerMessage } from './owner-commands';
import { openPrivate, sealPrivate } from './private-input';
import type { MessageInput } from '../shared/ipc';
import { TaskExecution } from './task-execution';

type Question = Extract<Interaction, { kind: 'question' }>;
interface SavedAnswer {
  interaction: Question;
  answer: InteractionAnswer;
  encrypted?: string;
  deliveryId?: string;
  requestEpoch?: string;
  acceptedAt?: number;
  executionGuard?: { runId: string; intent: number };
}
/** Decisions and all answers precede continuation. Several cards become one complete delivery. */
export class QuestionAnswers {
  private readonly db: AppDb;
  private readonly key: string;
  constructor(db: AppDb, owner: string) {
    this.db = db;
    this.key = `question.answers.${owner}`;
  }
  accept(
    question: Question,
    answer: InteractionAnswer,
    emit: (event: TimelineEvent) => void,
    requestEpoch?: string,
    executionGuard?: SavedAnswer['executionGuard'],
  ): void {
    validateQuestionAnswer(question, answer);
    const previous = this.pending({ items: [], turns: [], interactions: [], status: 'idle' });
    if (
      previous &&
      this.modern() &&
      this.db.commands.get(previous.commandId)?.state === 'delivered'
    )
      this.delivered();
    const sanitized = withoutSecrets(question, answer);
    const encrypted = question.questions.some((q) => q.secret) ? sealPrivate(answer) : undefined;
    const saved = this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? [];
    if (
      saved.some(
        (entry) =>
          entry.interaction.id === question.id &&
          (!entry.deliveryId || entry.requestEpoch !== requestEpoch),
      )
    )
      throw new Error(
        'An earlier answer with this adapter ID still awaits delivery; review is required.',
      );
    const existing = saved.find(
      (entry) =>
        entry.deliveryId &&
        entry.interaction.id === question.id &&
        entry.requestEpoch === requestEpoch,
    );
    if (
      existing &&
      coordinationHash(existing.encrypted ? openPrivate(existing.encrypted) : existing.answer) !==
        coordinationHash(answer)
    )
      throw new Error('This answer was already accepted; its delivery cannot be replaced.');
    const entry: SavedAnswer = {
      interaction: question,
      answer: sanitized,
      deliveryId: existing?.deliveryId ?? randomUUID(),
      requestEpoch,
      acceptedAt: existing?.acceptedAt ?? Date.now(),
      ...(executionGuard ? { executionGuard } : {}),
      ...(encrypted ? { encrypted } : {}),
    };
    const entries = [...saved.filter((entry) => entry.interaction.id !== question.id), entry];
    this.db.setSetting(this.key, entries);
    this.replay(entry, emit);
  }
  private replay(entry: SavedAnswer, emit: (event: TimelineEvent) => void, close = true): void {
    const { interaction: question, answer } = entry;
    emit({
      t: 'item.upsert',
      item: {
        id: this.decisionId(entry),
        turnId: '',
        kind: 'decision',
        interaction: question,
        answer,
        status: 'done',
        startedAt: entry.acceptedAt ?? 0,
        native: { agent: 'skaro', type: 'decision', ref: question.id },
      },
    });
    if (close) emit({ t: 'interaction.closed', id: question.id, resolution: 'answered' });
  }
  /** Replay acceptance after a crash between the database commit and the journal write. */
  recover(state: TimelineState, emit: (event: TimelineEvent) => void): void {
    const entries = this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? [];
    for (const entry of entries) {
      const matches = !!entry.requestEpoch && entry.requestEpoch === state.turns.at(-1)?.id;
      const open = state.interactions.some((i) => i.id === entry.interaction.id);
      if ((open && matches) || !state.items.some((i) => i.id === this.decisionId(entry)))
        this.replay(entry, emit, open && matches);
    }
  }
  pending(state: TimelineState): (MessageInput & { commandId: string }) | undefined {
    if (state.interactions.some((i) => i.kind === 'question')) return undefined;
    const entries = (this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? []).filter(
      (entry) => {
        if (!entry.executionGuard) return true;
        const { runId, intent } = entry.executionGuard;
        const run = this.db.getRun(runId);
        const execution = new TaskExecution(this.db, runId);
        return (
          !!run &&
          !run.retiredAt &&
          this.db.latestRun(run.projectId, run.taskId)?.id === runId &&
          execution.read().enabled &&
          execution.intentVersion() === intent
        );
      },
    );
    if (!entries.length) return undefined;
    const textOf = (values: SavedAnswer[]) =>
      values
        .map((entry) =>
          entry.interaction.questions
            .map(
              (q) =>
                `${q.text}\n${entry.answer.kind === 'question' ? (entry.answer.answers[q.id]?.join('\n') ?? '') : ''}`,
            )
            .join('\n\n'),
        )
        .join('\n\n');
    const text = textOf(entries);
    const secrets: string[] = [];
    const decoded = entries.map((entry) => {
      if (!entry.encrypted) return entry;
      const answer = openPrivate<InteractionAnswer>(entry.encrypted);
      if (answer.kind === 'question')
        for (const question of entry.interaction.questions)
          if (question.secret) secrets.push(...(answer.answers[question.id] ?? []));
      return { ...entry, answer };
    });
    return {
      text,
      ...(secrets.length ? { privateText: sealPrivate({ text: textOf(decoded), secrets }) } : {}),
      commandId: entries.every((entry) => entry.deliveryId)
        ? `answers-${coordinationHash([this.key, entries.map((entry) => entry.deliveryId)])}`
        : `answers-${entries.map((entry) => entry.interaction.id).join('-')}`,
    };
  }
  delivered(): void {
    this.db.setSetting(this.key, null);
  }
  private modern(): boolean {
    const entries = this.db.getSetting<SavedAnswer[] | null>(this.key, []) ?? [];
    return entries.length > 0 && entries.every((entry) => !!entry.deliveryId);
  }
  private decisionId(entry: SavedAnswer): string {
    return `skaro-decision-${entry.deliveryId ?? entry.interaction.id}`;
  }
  queue(
    method: 'chat.send' | 'task.send',
    project: string,
    owner: string,
    state: TimelineState,
  ): void {
    const input = this.pending(state);
    if (!input) return;
    // Old adapter IDs alone cannot prove which acceptance was delivered.
    if (!this.modern()) return;
    const command = this.db.commands.get(input.commandId);
    if (command && (command.owner !== `${project}:${owner}` || command.method !== method))
      throw new Error('Saved answer delivery belongs to another owner; review is required.');
    if (command?.state === 'delivered') {
      if (!this.modern())
        throw new Error('Legacy answer delivery is ambiguous; review is required.');
      this.delivered();
      return;
    }
    if (command) return;
    queueOwnerMessage(method, project, owner, input);
  }
}
