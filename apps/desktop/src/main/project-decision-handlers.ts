import { projectActivityPage } from './project-activity';
import type { AppDb } from '@skaro/core';
import type { Handlers } from './ipc';
import type { Services } from './app-services';
import type { DecisionAnswer, ProjectDecision } from '../shared/project-decisions';
import { DecisionSources, decisionReaders } from './decision-sources';
import { DecisionReplies } from './decision-replies';
import { validateQuestionAnswer } from '@skaro/timeline';
import { decisionIsSafety } from './decision-authority';
import { requireCoordinationDispatch } from './coordination-dispatch';

/** Wrap the existing executors. The window and original feed enter this same gate. */
export function projectDecisionHandlers<T extends Partial<Handlers>>(
  services: Pick<Services, 'db' | 'runs' | 'chats' | 'c4'>,
  original: T,
) {
  const reader = new DecisionSources(services),
    replies = new DecisionReplies(services.db);
  decisionReaders.set(services.db, reader);
  const execute = async (entry: ProjectDecision, action: DecisionAnswer) => {
    if (!decisionIsSafety(action)) requireCoordinationDispatch(services.db, entry.origin.projectId);
    const expected =
      entry.kind === 'proposal'
        ? 'proposal'
        : entry.interaction.kind === 'merge'
          ? 'merge'
          : 'respond';
    if (
      action.kind !== expected ||
      (action.kind === 'proposal' && action.action.action === 'revert')
    )
      throw new Error('decision_answer_kind_invalid');
    if (entry.kind === 'interaction' && action.kind === 'respond') {
      validateQuestionAnswer(entry.interaction, action.answer);
      if (
        entry.interaction.kind !== action.answer.kind ||
        (entry.interaction.kind === 'approval' &&
          action.answer.kind === 'approval' &&
          !entry.interaction.choices.includes(action.answer.choice))
      )
        throw new Error('decision_answer_kind_invalid');
    }
    await replies.accept(
      entry,
      action,
      async () => {
        const current = (await reader.fresh(entry.origin)).find((row) => row.id === entry.id);
        if (!current || current.revision !== entry.revision) throw new Error('decision_stale');
      },
      async () => {
        const p = entry.origin.projectId,
          id = entry.origin.id;
        if (entry.kind === 'interaction' && action.kind === 'respond') {
          if (entry.interaction.kind === 'merge') throw new Error('decision_answer_kind_invalid');
          const method = entry.origin.kind === 'task' ? 'task.respond' : 'chat.respond';
          await original[method]!(p, id, entry.interaction.id, action.answer);
        } else if (
          entry.kind === 'interaction' &&
          entry.interaction.kind === 'merge' &&
          action.kind === 'merge'
        ) {
          await original['task.merge']!(p, id, entry.interaction.id, action.action);
        } else if (entry.kind === 'proposal' && action.kind === 'proposal') {
          if (entry.item.proposal.type === 'architecture') {
            if (action.action.action === 'revert') throw new Error('decision_answer_kind_invalid');
            await original['c4.decide']!(
              p,
              entry.item.id,
              action.action.action,
              action.action.action === 'apply' ? action.action.fingerprint : undefined,
            );
          } else if (entry.origin.kind === 'chat')
            await original['chat.proposal']!(p, id, entry.item.id, action.action);
          else throw new Error('decision_answer_kind_invalid');
        } else throw new Error('decision_answer_kind_invalid');
      },
    );
    reader.invalidate(entry.origin.projectId, entry.origin.kind, entry.origin.id);
  };
  const find = async (p: string, kind: 'task' | 'chat', owner: string, raw: string) => {
    reader.requireProject(p);
    const current = (
      await reader.fresh({ projectId: p, kind, id: owner, title: '', epoch: '' })
    ).find((row) =>
      row.kind === 'interaction' ? row.interaction.id === raw : row.item.id === raw,
    );
    if (!current) throw new Error('decision_stale');
    return current;
  };
  return {
    ...original,
    'activity.page': (project: string, cursor?: number) =>
      projectActivityPage(services.db, project, cursor),
    'decisions.status': (project: string, id: string, revision: string) => {
      const entry = reader.knownEntry(project, id, revision);
      if (!entry) return 'stale' as const;
      const accepted = replies.status(entry);
      if (accepted) return accepted;
      if (id.startsWith('coordinator:')) {
        const saved = services.db.coordination.decisions.get(
          project,
          id.slice('coordinator:'.length),
        );
        if (saved?.state === 'answered' || saved?.state === 'denied') return saved.state;
        const request = services.db.getSetting<{ expiresAt: number } | undefined>(
          `coordination.decision-action.${id.slice('coordinator:'.length)}`,
          undefined,
        );
        if (request && request.expiresAt <= Date.now()) return 'expired' as const;
      }
      return entry.kind === 'interaction' &&
        entry.interaction.kind === 'approval' &&
        entry.interaction.delivery !== 'async'
        ? ('expired' as const)
        : ('stale' as const);
    },
    'decisions.list': (project: string) => reader.list(project),
    'decisions.answer': async (
      project: string,
      id: string,
      revision: string,
      action: DecisionAnswer,
    ) => {
      const entry = (await reader.list(project)).find((row) => row.id === id);
      if (!entry || entry.revision !== revision) throw new Error('decision_stale');
      await execute(entry, action);
    },
    'task.respond': async (
      p: string,
      id: string,
      raw: string,
      answer: import('@skaro/timeline').InteractionAnswer,
    ) => execute(await find(p, 'task', id, raw), { kind: 'respond', answer }),
    'incidents.answer': async (
      p: string,
      id: string,
      answer: import('@skaro/timeline').InteractionAnswer,
    ) => {
      const entry = (await reader.list(p)).find((row) => row.id === `coordinator:${id}`);
      if (!entry) throw new Error('decision_stale');
      await execute(entry, { kind: 'respond', answer });
    },
    'chat.respond': async (
      p: string,
      id: string,
      raw: string,
      answer: import('@skaro/timeline').InteractionAnswer,
    ) => execute(await find(p, 'chat', id, raw), { kind: 'respond', answer }),
    'task.merge': async (
      p: string,
      id: string,
      raw: string,
      action: import('../shared/ipc').MergeAction,
    ) => execute(await find(p, 'task', id, raw), { kind: 'merge', action }),
    'chat.proposal': async (
      p: string,
      id: string,
      raw: string,
      action: import('../shared/ipc').ProposalAction,
    ) => {
      if (action.action === 'revert') return original['chat.proposal']!(p, id, raw, action);
      return execute(await find(p, 'chat', id, raw), { kind: 'proposal', action });
    },
    'c4.decide': async (
      p: string,
      raw: string,
      action: 'apply' | 'reject',
      fingerprint?: string,
    ) => {
      if (
        action === 'apply' &&
        (await services.c4.records(p)).some(
          (record) => record.item.id === raw && record.item.state === 'accepted',
        )
      )
        return original['c4.decide']!(p, raw, action);
      const entry = (await reader.list(p)).find(
        (row) => row.kind === 'proposal' && row.item.id === raw,
      );
      if (!entry) throw new Error('decision_stale');
      await execute(entry, {
        kind: 'proposal',
        action: action === 'apply' ? { action, fingerprint: fingerprint! } : { action },
      });
    },
  };
}

/** Used by the common event fan-out; only decision/control changes invalidate an owner. */
export function observeProjectDecisions(
  db: AppDb,
  name: string,
  payload: unknown,
): string | undefined {
  const reader = decisionReaders.get(db),
    event = payload as {
      projectId?: string;
      taskId?: string;
      chatId?: string;
      events?: { t: string; item?: { kind: string } }[];
    };
  if (!reader || !event.projectId) return;
  if (
    name.endsWith('.events') &&
    !event.events?.some(
      (e) =>
        e.t.startsWith('interaction.') ||
        e.t === 'turn.completed' ||
        (e.t === 'item.upsert' && e.item?.kind === 'proposal'),
    )
  )
    return;
  if (
    ![
      'task.events',
      'integration.events',
      'chat.events',
      'task.changed',
      'chats.changed',
      'project.changed',
    ].includes(name)
  )
    return;
  reader.invalidate(
    event.projectId,
    event.taskId ? 'task' : event.chatId ? 'chat' : undefined,
    event.taskId ?? event.chatId,
  );
  return event.projectId;
}
