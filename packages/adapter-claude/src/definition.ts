import packageManifest from '../package.json' with { type: 'json' };
import type { AgentDefinition } from '@skaro/timeline';
import { CLAUDE_ADAPTER_VERSION } from './version.ts';

export const claudeDefinition = {
  presentation: {
    id: 'claude-code' as const,
    name: 'Claude Code',
    boardLogoSize: 17,
    logo: {
      viewBox: '0 0 24 24',
      paths: [
        {
          d: 'M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z',
          fill: '#D97757',
          fillRule: 'evenodd',
          clipRule: 'evenodd',
        },
      ],
    },
  },
  package: packageManifest,
  adapterVersion: CLAUDE_ADAPTER_VERSION,
  pin: { version: '0.3.285', shownVersion: '2.1.285' },
  downloadSize: 230e6,
  capabilities: {
    resume: true,
    images: true,
    compact: true,
    rewind: 'conversation-and-files',
    backgroundStop: true,
  },
  chatSandboxCheck: false,
  instructionFiles: ['AGENTS.md', 'CLAUDE.md'],
  questionTool: 'AskUserQuestion',
  questionAgentName: 'Claude',
  releaseOrder: 1,
  probeAlias: 'claude' as const,
  diagnosticVersionKey: 'claude' as const,
  legacyBundlePin: 'claudeSdk' as const,
  sdkDependency: '@anthropic-ai/claude-agent-sdk',
  distribution(platform, pin) {
    const key = `${platform.os}-${platform.arch}`;
    if (
      !['win32', 'darwin', 'linux'].includes(platform.os) ||
      !['x64', 'arm64'].includes(platform.arch)
    )
      throw new Error(`Claude Code is not available for ${key}`);
    return {
      agent: 'claude-code',
      ...pin,
      name: `@anthropic-ai/claude-agent-sdk-${key}${platform.musl ? '-musl' : ''}`,
      npmVersion: pin.version,
      binary: `claude${platform.os === 'win32' ? '.exe' : ''}`,
      pathDirs: [],
    };
  },
  async loadProjector() {
    const { ClaudeProjector } = await import('./projector.ts');
    return (context, emit) => new ClaudeProjector(context, emit);
  },
  loadRuntime: () => import('./agent-runtime.ts'),
} satisfies AgentDefinition;
