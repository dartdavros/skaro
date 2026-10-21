import type { AgentSession, SessionOptions, TimelineEvent } from '@skaro/timeline';
import type { OwnedProcess } from '../process-identity';

export type SessionMethod = Exclude<keyof AgentSession, 'events'>;
export interface NativeConfig {
  agent: 'codex' | 'claude-code';
  binary: string;
  pathDirs: string[];
  attachmentsDir: string;
  authRevision: SharedArrayBuffer;
}
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
  | { type: 'reply'; id: number; error?: string }
  | { type: 'raw'; bytes: ArrayBuffer }
  | { type: 'event'; event: TimelineEvent }
  | { type: 'spawn'; process: OwnedProcess; gate: SharedArrayBuffer }
  | { type: 'ended'; error?: string };
