import type { AgentSettings, MessageInput } from '../shared/ipc';
import { parseBuiltinSessionSelection } from './builtin-session-selection';

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
export type BuiltinTaskHandoffRequest = Omit<BuiltinTaskLaunchRequest, 'input'>;

/** Main-only launch selection. A route ID is required; no managed or provider fallback is inferred. */
export function parseBuiltinTaskStart(value: unknown): BuiltinTaskStart {
  const selected = value as Partial<BuiltinTaskStart> | null;
  if (
    !selected ||
    typeof selected !== 'object' ||
    Object.keys(selected).some(
      (key) =>
        !['agent', 'model', 'effort', 'permissionMode', 'planFirst', 'isolation'].includes(key),
    ) ||
    typeof selected.planFirst !== 'boolean' ||
    !['worktree', 'in-place'].includes(selected.isolation ?? '')
  )
    throw new Error(
      'Builtin launch requires an exact route, permission mode and isolation selection',
    );
  const { planFirst, isolation, ...common } = selected;
  return { ...parseBuiltinSessionSelection(common), planFirst, isolation: isolation! };
}
