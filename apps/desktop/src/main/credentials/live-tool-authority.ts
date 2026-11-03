import type { CommandResult } from '@skaro/agent-runtime';

const limits: Record<string, number> = { 'AGENTS.md': 2, 'package.json': 3, '.git/HEAD': 1 };
export const liveToolAdmission = {
  revision: 'owner-approved-first-lines-v1',
  requireAllowed(name: string, value: unknown): void {
    const args = value as Record<string, unknown> | null;
    if (
      name !== 'read_file' ||
      !args ||
      typeof args.path !== 'string' ||
      !Object.hasOwn(limits, args.path) ||
      (args.startLine !== undefined && args.startLine !== 1) ||
      (args.column !== undefined && args.column !== 0) ||
      typeof args.maxLines !== 'number' ||
      !Number.isInteger(args.maxLines) ||
      args.maxLines < 1 ||
      args.maxLines > limits[args.path]!
    )
      throw new Error('Unapproved file payload');
  },
  projectResult(result: CommandResult): unknown {
    if (result.error) return { error: result.error };
    const value = result.value as { text?: string } | undefined;
    if (typeof value?.text !== 'string') throw new Error('Invalid real read result');
    return { text: value.text };
  },
};
