import type { UserInput } from './agent.ts';
import type { RuntimeModelRequest, RuntimeModelResponse } from './builtin-model-wire.ts';

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
  /** Called at a model boundary. Native terminal output is provided separately until formatted. */
  steer?(
    input: RuntimeOwnerInput,
    request: RuntimeModelRequest,
    terminalResponse: { requestId: string; response: RuntimeModelResponse } | undefined,
    signal: AbortSignal,
  ): Promise<RuntimeModelRequest>;
}
