import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { OwnedProcess } from '../process-identity.ts';

export interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  owner: OwnedProcess;
  output: string;
  finished: Promise<void>;
  resolveFinished(): void;
  code?: number | null;
  signal?: string | null;
  error?: string;
  stopping?: Promise<void>;
  timer?: NodeJS.Timeout;
  replies: Map<string, { resolve(): void; reject(error: Error): void }>;
  exited?: boolean;
  launched: Promise<void>;
  resolveLaunched(): void;
}
