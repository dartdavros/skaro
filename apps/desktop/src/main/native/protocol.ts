import type {
  AgentSession,
  SessionOptions,
  TimelineEvent,
  RuntimeVerificationBinding,
  VerificationInspectRequest,
  VerificationCancelRequest,
  RuntimeExtensionBinding,
  RuntimeRpcRequest,
  RuntimeModelBinding,
  RuntimeModelRpcRequest,
} from '@skaro/timeline';
import type { OwnedProcess } from '../process-identity';

export type SessionMethod =
  Exclude<keyof AgentSession, 'events'> | 'invokeTool' | 'runModelTurn' | 'deliverInput';
interface ManagedNativeConfig {
  agent: import('@skaro/agents').AgentId;
  binary: string;
  pathDirs: string[];
  attachmentsDir: string;
  authRevision: SharedArrayBuffer;
}
export type NativeConfig =
  | ManagedNativeConfig
  | {
      agent: string;
      bundled: import('@skaro/timeline').BuiltinSessionStart;
      entry: string;
      attachmentsDir: string;
      verification?: RuntimeVerificationBinding;
      extensions?: RuntimeExtensionBinding;
      model?: RuntimeModelBinding;
    };
export type NativeOptions = Omit<
  SessionOptions,
  'raw' | 'rawSerialized' | 'secretValues' | 'context' | 'processStarted' | 'signal'
>;
export interface Request {
  id: number;
  method: SessionMethod | 'start';
  args: unknown[];
  secrets: string[];
}
export type Reply =
  | { type: 'reply'; id: number; error?: string; value?: unknown }
  | { type: 'raw'; bytes: ArrayBuffer }
  | { type: 'event'; event: TimelineEvent }
  | { type: 'spawn'; process: OwnedProcess; gate: SharedArrayBuffer }
  | { type: 'ended'; error?: string }
  | VerificationInspectRequest
  | VerificationCancelRequest
  | RuntimeRpcRequest
  | RuntimeModelRpcRequest;
