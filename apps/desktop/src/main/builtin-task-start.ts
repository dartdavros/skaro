import type { AgentSettings, MessageInput } from '../shared/ipc';

export type BuiltinTaskStartOptions = Omit<AgentSettings, 'agent'> & { model: string };
export type BuiltinTaskStart = BuiltinTaskStartOptions & { agent: 'skaro' };
export interface BuiltinTaskLaunchRequest {
  projectId: string;
  taskId: string;
  input: MessageInput & { commandId: string };
  settings: BuiltinTaskStartOptions;
  /** Cancels admission before it enters the durable task queue; never serialized or saved. */
  signal: AbortSignal;
}

/** Main-only launch selection. A route ID is required; no managed or provider fallback is inferred. */
export function parseBuiltinTaskStart(value: unknown): BuiltinTaskStart {
  const selected = value as Partial<BuiltinTaskStart> | null;
  if (
    !selected ||
    typeof selected !== 'object' ||
    selected.agent !== 'skaro' ||
    Object.keys(selected).some(
      (key) =>
        !['agent', 'model', 'effort', 'permissionMode', 'planFirst', 'isolation'].includes(key),
    ) ||
    typeof selected.model !== 'string' ||
    !selected.model.trim() ||
    selected.model.length > 512 ||
    (selected.effort !== undefined &&
      (typeof selected.effort !== 'string' ||
        !selected.effort.trim() ||
        selected.effort.length > 64)) ||
    !['ask', 'auto', 'full'].includes(selected.permissionMode ?? '') ||
    typeof selected.planFirst !== 'boolean' ||
    !['worktree', 'in-place'].includes(selected.isolation ?? '')
  )
    throw new Error(
      'Builtin launch requires an exact route, permission mode and isolation selection',
    );
  return {
    agent: 'skaro',
    model: selected.model,
    ...(selected.effort ? { effort: selected.effort } : {}),
    permissionMode: selected.permissionMode!,
    planFirst: selected.planFirst,
    isolation: selected.isolation!,
  };
}
