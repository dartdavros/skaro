import { type PermissionMode as NativeMode } from '@anthropic-ai/claude-agent-sdk';
import { type PermissionMode } from '@skaro/timeline';

export const PLAN_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'];
export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
export const SHELL_TOOLS = ['Bash', 'PowerShell'];
export function nativeMode(mode: PermissionMode, planFirst = false): NativeMode {
  if (planFirst) return 'plan';
  return mode === 'full' ? 'bypassPermissions' : mode === 'auto' ? 'acceptEdits' : 'default';
}
export interface ClaudeSessionConfig {
  /** Pinned CLI binary from the installer. */
  executable: string;
  /** Overrides the config dir (tests, "not logged in" checks). */
  configDir?: string;
}
