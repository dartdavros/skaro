export type CommandControl =
  | { type: 'run'; command: string; shell: string; cwd: string; outputPath: string }
  | { type: 'stdin'; id: string; chars: string; end: boolean };
export type CommandEvent =
  | { type: 'ready' }
  | { type: 'launched'; pid: number }
  | { type: 'exit'; code: number | null; signal: string | null; bytes: number }
  | { type: 'stdin'; id: string; error?: string }
  | { type: 'error'; error: string };
