import { type Options } from '@anthropic-ai/claude-agent-sdk';
import { type PermissionMode, type SessionOptions } from '@skaro/timeline';
import { type ClaudeSessionConfig, nativeMode, PLAN_TOOLS, EDIT_TOOLS } from './session-config.ts';

export function queryOptions(
  o: SessionOptions,
  config: ClaudeSessionConfig,
  mode: PermissionMode,
  planFirst: boolean,
  handlers: Pick<Options, 'canUseTool' | 'onElicitation' | 'spawnClaudeCodeProcess'>,
): Options {
  return {
    cwd: o.cwd,
    pathToClaudeCodeExecutable: config.executable,
    permissionMode: nativeMode(mode, planFirst),
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    enableFileCheckpointing: true,
    // Skaro's own tools confirm through their cards (merge_task), never through a permission prompt.
    allowedTools: [...PLAN_TOOLS, ...(o.mcpServers?.['skaro'] ? ['mcp__skaro'] : [])],
    ...(o.readOnly ? { disallowedTools: EDIT_TOOLS } : {}),
    canUseTool: handlers.canUseTool,
    onElicitation: handlers.onElicitation,
    spawnClaudeCodeProcess: handlers.spawnClaudeCodeProcess,
    env: {
      ...process.env,
      ...(config.configDir ? { CLAUDE_CONFIG_DIR: config.configDir } : {}),
    },
    // Without summaries the thinking arrives empty: minutes of "Думает…" with nothing to show.
    settings: { showThinkingSummaries: true },
    ...(o.model ? { model: o.model } : {}),
    ...(o.effort ? { effort: o.effort as Options['effort'] } : {}),
    ...(o.instructions
      ? {
          systemPrompt: {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: o.instructions,
          },
        }
      : {}),
    ...(o.mcpServers ? { mcpServers: o.mcpServers } : {}),
    ...(o.readDirs?.length ? { additionalDirectories: o.readDirs } : {}),
    // D-28: the Bash sandbox only where the self-check showed it holds the boundary.
    ...(o.sandboxVerified && mode === 'auto'
      ? { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }
      : {}),
  };
}
