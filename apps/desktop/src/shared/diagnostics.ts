export interface Diagnostics {
  format: 1;
  createdAt: string;
  versions: { app: string; electron: string; node: string; codex: string; claude: string };
  platform: { os: string; arch: string };
  logs: { scanned: number; unavailable: number; invalidLines: number; projectionErrors: number };
  unknownEvents: number;
  /** Type digests permit comparisons without exporting untrusted native labels. */
  unknown: {
    agent: 'codex' | 'claude-code' | 'unknown';
    typeHash: string;
    count: number;
    shape: Record<string, number>;
  }[];
}
