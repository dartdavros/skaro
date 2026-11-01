import type { UserInput } from './agent.ts';
import type { RuntimeModelRequest } from './builtin-model-wire.ts';

/** Exact owner input already committed by the runtime; never permission inferred from model text. */
export interface RuntimeOwnerInput {
  commandId: string;
  id: string;
  turnId: string;
  mode: 'send' | 'steer';
  input: UserInput;
  timestamp: number;
}
export interface RuntimePreparedModelTurn {
  request: RuntimeModelRequest;
  maxSteps: number;
}
export interface RuntimeModelInputPort {
  revision: string;
  /** Context, history and connector-specific formatting remain with the privileged host. No POST. */
  prepare(input: RuntimeOwnerInput, signal: AbortSignal): Promise<RuntimePreparedModelTurn>;
}
