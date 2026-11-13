import type { AppDb } from '@skaro/core';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { MessageInput } from '../shared/ipc';
import { parseBuiltinTaskStart, type BuiltinTaskStart } from './builtin-task-start';

interface Startup {
  inputs: MessageInput[];
  dispatchRevision?: number;
  c4Protocol?: import('@skaro/core').C4Protocol;
  error?: string;
  updatedAt: number;
  builtin?: BuiltinTaskStart;
  builtinAttempt?: string;
}

/** Preparation failures exist before an agent run; their input and diagnostic must survive. */
export class TaskStartup {
  private readonly epochs = new Map<string, number>();
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting' | 'listEvents'>;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting' | 'listEvents'>) {
    this.db = db;
  }
  private key(project: string, task: string) {
    return `startup.${project}.${task}`;
  }
  read(project: string, task: string): Startup | undefined {
    return this.db.getSetting<Startup | null>(this.key(project, task), null) ?? undefined;
  }
  cancellationEpoch(project: string, task: string): number {
    return this.epochs.get(this.key(project, task)) ?? 0;
  }
  selectBuiltin(project: string, task: string, settings: BuiltinTaskStart): void {
    if (this.read(project, task)?.inputs.length)
      throw new Error('The task already has pending owner input');
    this.db.setSetting(this.key(project, task), {
      inputs: [],
      builtin: parseBuiltinTaskStart(settings),
      builtinAttempt: randomUUID(),
      updatedAt: Date.now(),
    });
  }
  retryBuiltin(
    project: string,
    task: string,
    settings: BuiltinTaskStart,
    input: MessageInput,
  ): boolean {
    const saved = this.read(project, task);
    if (!saved?.inputs.length) return false;
    if (
      !saved.builtinAttempt ||
      !isDeepStrictEqual(saved.builtin, settings) ||
      !input.commandId ||
      !saved.inputs.some((pending) => isDeepStrictEqual(pending, input))
    )
      throw new Error('Retry requires the exact pending builtin selection and owner input');
    return true;
  }
  begin(
    project: string,
    task: string,
    inputs: MessageInput[],
    dispatchRevision?: number,
    c4Protocol?: import('@skaro/core').C4Protocol,
  ): MessageInput[] {
    const saved = this.read(project, task);
    if (
      saved?.inputs.length &&
      dispatchRevision !== undefined &&
      saved.dispatchRevision !== dispatchRevision
    )
      throw new Error(
        'Pending task startup belongs to an earlier dispatch generation; stop it before a fresh request.',
      );
    const combined = [...(saved?.inputs ?? [])];
    for (const input of inputs)
      if (!input.commandId || !combined.some((existing) => existing.commandId === input.commandId))
        combined.push(input);
    this.db.setSetting(this.key(project, task), {
      inputs: combined,
      ...((c4Protocol ?? saved?.c4Protocol) ? { c4Protocol: c4Protocol ?? saved?.c4Protocol } : {}),
      ...((dispatchRevision ?? saved?.dispatchRevision) !== undefined
        ? { dispatchRevision: dispatchRevision ?? saved?.dispatchRevision }
        : {}),
      ...(saved?.builtin ? { builtin: saved.builtin, builtinAttempt: saved.builtinAttempt } : {}),
      error: undefined,
      updatedAt: Date.now(),
    });
    return combined.length ? combined : [{ text: '' }];
  }
  delivered(project: string, task: string): void {
    this.db.setSetting(this.key(project, task), null);
  }
  cancel(project: string, task: string): void {
    this.epochs.set(this.key(project, task), this.cancellationEpoch(project, task) + 1);
    this.delivered(project, task);
  }
  fail(project: string, task: string, error: string): void {
    const saved = this.read(project, task);
    this.db.setSetting(this.key(project, task), {
      inputs: saved?.inputs ?? [],
      ...(saved?.c4Protocol ? { c4Protocol: saved.c4Protocol } : {}),
      ...(saved?.dispatchRevision !== undefined
        ? { dispatchRevision: saved.dispatchRevision }
        : {}),
      ...(saved?.builtin ? { builtin: saved.builtin, builtinAttempt: saved.builtinAttempt } : {}),
      error,
      updatedAt: Date.now(),
    });
  }
  error(project: string, task: string): string | undefined {
    const saved = this.read(project, task);
    if (saved) return saved.error;
    return this.db
      .listEvents(project, 200)
      .find(
        (event) => event.kind === 'task_failed' && (event.data as { task?: string }).task === task,
      )?.data.error as string | undefined;
  }
}
