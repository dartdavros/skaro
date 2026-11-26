export interface DiagnosticMemory {
  sampledAt: string;
  scope: 'process-tree' | 'electron-only' | 'main-only';
  /** Per-process resident/working-set bytes. Shared pages may appear in several rows. */
  processes: { role: string; residentBytes: number }[];
}

export interface Diagnostics {
  format: 1;
  createdAt: string;
  versions: { app: string; electron: string; node: string } & Record<
    import('@skaro/agents').DiagnosticVersionKey,
    string
  >;
  platform: { os: string; arch: string };
  memory?: DiagnosticMemory;
  logs: { scanned: number; unavailable: number; invalidLines: number; projectionErrors: number };
  unknownEvents: number;
  /** Type digests permit comparisons without exporting untrusted native labels. */
  unknown: {
    agent: import('@skaro/agents').AgentId | 'unknown';
    typeHash: string;
    count: number;
    shape: Record<string, number>;
  }[];
}
