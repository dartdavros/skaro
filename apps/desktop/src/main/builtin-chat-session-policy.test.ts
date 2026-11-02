import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  type BuiltinSessionStart,
} from '@skaro/timeline';
import { requireBuiltinChatSessionPolicy } from './builtin-chat-session-policy';

// Pure scope/file-policy contracts; no ChatRecord, LiveChat, backend or model is fabricated.
function policy() {
  const scope = {
    kind: 'project_chat' as const,
    projectId: 'project',
    chatId: 'chat',
    importId: 'import',
  };
  const expected = {
    scope,
    sessionId: 'session',
    journalPath: resolve('journal.jsonl'),
    artifactDir: resolve('artifacts'),
    options: {
      cwd: resolve('.'),
      readDirs: [resolve('apps')],
      permissionMode: 'ask' as const,
      instructions: 'Exact chat/import instructions',
    },
  };
  const config: BuiltinSessionStart = {
    sessionId: expected.sessionId,
    journalPath: expected.journalPath,
    permissionMode: 'ask',
    versions: BUILTIN_CONTRACT_VERSIONS,
    route: {
      schema: 1,
      routeId: 'route',
      routeRevision: 1,
      connectionId: 'not-connected',
      connectionRevision: 1,
      connector: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
      modelId: 'not-requested',
      parameters: {},
      upstream: DEFAULT_UPSTREAM_POLICY,
    },
    tools: {
      cwd: expected.options.cwd,
      readDirs: expected.options.readDirs,
      readOnly: false,
      artifactDir: expected.artifactDir,
    },
    context: {
      scopePath: '.',
      documents: [],
      pins: [
        {
          id: 'chat',
          kind: 'constraint',
          origin: 'host',
          revision: '1',
          text: expected.options.instructions,
        },
      ],
    },
    model: { scope, protocol: 'chat', input: { revision: 'owner-input' } },
    extensionsScope: scope,
  };
  return { expected, config };
}

it('keeps exact chat/import identity and rejects task verification authority', () => {
  const { expected, config } = policy();
  expect(() => requireBuiltinChatSessionPolicy(expected, config)).not.toThrow();
  for (const change of [
    { ...expected, scope: { ...expected.scope, runId: 'task-run' } },
    { ...expected, scope: { ...expected.scope, taskId: 'task' } },
    { ...expected, scope: { ...expected.scope, kind: 'task' as const } },
    { ...expected, scope: { ...expected.scope, chatId: '' } },
  ])
    expect(() => requireBuiltinChatSessionPolicy(change, config)).toThrow('chat/import scope');
  expect(() =>
    requireBuiltinChatSessionPolicy(expected, {
      ...config,
      tools: {
        ...config.tools!,
        verificationScope: { kind: 'task', projectId: 'project', taskId: 'task', runId: 'run' },
      },
    }),
  ).toThrow('without task authority');
  for (const scope of [
    { ...expected.scope, importId: 'other' },
    { ...expected.scope, chatId: 'other' },
    { ...expected.scope, projectId: 'other' },
  ]) {
    expect(() =>
      requireBuiltinChatSessionPolicy(expected, {
        ...config,
        model: { ...config.model!, scope },
      }),
    ).toThrow('owner session');
    expect(() =>
      requireBuiltinChatSessionPolicy(expected, { ...config, extensionsScope: scope }),
    ).toThrow();
  }
});

it('retains chat/import instructions and narrows external file access without privilege escalation', () => {
  const { expected, config } = policy();
  expect(() =>
    requireBuiltinChatSessionPolicy(expected, {
      ...config,
      tools: { ...config.tools!, readDirs: [] },
    }),
  ).not.toThrow();
  expect(() =>
    requireBuiltinChatSessionPolicy(expected, {
      ...config,
      tools: { ...config.tools!, readDirs: [resolve('..')] },
    }),
  ).toThrow();
  expect(() =>
    requireBuiltinChatSessionPolicy(expected, { ...config, permissionMode: 'full' }),
  ).toThrow();
  expect(() =>
    requireBuiltinChatSessionPolicy(expected, {
      ...config,
      context: { ...config.context!, pins: [] },
    }),
  ).toThrow('owner instructions');
  expect(() =>
    requireBuiltinChatSessionPolicy(expected, { ...config, journalPath: resolve('other.jsonl') }),
  ).toThrow();
});
