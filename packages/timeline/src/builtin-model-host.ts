import type { RuntimeVerificationBinding } from './builtin-host.ts';
import type { RouteSnapshot } from './builtin-model.ts';
import type { RuntimeModelInputPort } from './builtin-owner-input.ts';
import type {
  ModelTool,
  NativeRequest,
  NativeResponse,
  NativeToolResult,
  RuntimeModelRequest,
  RuntimeModelResponse,
} from './builtin-model-wire.ts';

export interface RuntimeModelToolResult {
  error?: string;
  value?: unknown;
}
export interface ModelToolAdmission {
  revision: string;
  requireAllowed(name: string, args: unknown, signal?: AbortSignal): void | Promise<void>;
  projectResult(result: RuntimeModelToolResult, signal?: AbortSignal): unknown;
  selectChatTools?(
    catalogue: readonly ModelTool[],
    signal?: AbortSignal,
  ): readonly ModelTool[] | Promise<readonly ModelTool[]>;
  chatToolsRequired?: boolean;
  rejectionMessage?: string;
}
export interface RuntimeModelPolicy {
  scope: RuntimeVerificationBinding['scope'];
  protocol: RuntimeModelRequest['kind'];
  input?: { revision: string; steer?: true };
  tools?: {
    revision: string;
    selectChatTools: boolean;
    chatToolsRequired?: boolean;
    rejectionMessage?: string;
  };
}
export interface RuntimeModelBinding extends RuntimeVerificationBinding {
  route: RouteSnapshot;
  journalPath: string;
  /** Captured before worker startup. Old pending intents cannot acquire a new request permit. */
  baseSequence: number;
  baseHash: string;
  policy: RuntimeModelPolicy;
}
export interface RuntimeModelHost extends RuntimeModelBinding {
  signal?: AbortSignal;
  input?: RuntimeModelInputPort;
  toolAdmission?: ModelToolAdmission;
  /** Quotation only; runtime persists this reservation before complete is permitted. */
  reserve(
    id: string,
    request: RuntimeModelRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>>;
  complete(
    id: string,
    request: RuntimeModelRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<RuntimeModelResponse>;
  continue?(
    request: NativeRequest,
    response: NativeResponse,
    results: readonly NativeToolResult[],
    signal: AbortSignal,
  ): NativeRequest | Promise<NativeRequest>;
}
export type RuntimeModelRpcRequest =
  | { type: 'model-rpc-call'; id: string; operation: string; args: unknown }
  | { type: 'model-rpc-cancel'; id: string };
export type RuntimeModelRpcReply =
  | { type: 'model-rpc-result'; id: string; value?: unknown; error?: true }
  | { type: 'model-rpc-text'; id: string; text: string };
