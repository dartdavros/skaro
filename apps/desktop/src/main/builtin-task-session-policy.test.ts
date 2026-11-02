import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  BUILTIN_CONTRACT_VERSIONS,
  DEFAULT_UPSTREAM_POLICY,
  type BuiltinSessionStart,
} from '@skaro/timeline';
import { requireBuiltinTaskSessionPolicy } from './builtin-task-session-policy';

// Pure admission DTOs: no project/run records, providers or replacement service are created.
function policy() {
  const scope = { kind: 'task' as const, projectId: 'project', taskId: 'task', runId: 'run' };
  const expected = {
    scope,
    sessionId: 'native-session',
    journalPath: resolve('journal.jsonl'),
    artifactDir: resolve('artifacts'),
    options: {
      cwd: resolve('.'),
      permissionMode: 'ask' as const,
      instructions: 'Exact task + handoff',
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
      readDirs: [],
      readOnly: false,
      artifactDir: expected.artifactDir,
    },
    context: {
      scopePath: '.',
      documents: [],
      pins: [
        {
          id: 'task',
          kind: 'constraint',
          origin: 'host',
          revision: '1',
          text: expected.options.instructions,
        },
      ],
    },
    model: { scope, protocol: 'chat', input: { revision: 'owner-input' } },
  };
  return { expected, config };
}

it('binds task startup to its exact scope, native journal, file access and task instructions', () => {
  const { expected, config } = policy();
  expect(() => requireBuiltinTaskSessionPolicy(expected, config)).not.toThrow();
  const mutations: ((config: BuiltinSessionStart) => void)[] = [
    (value) => {
      value.sessionId = 'other';
    },
    (value) => {
      value.journalPath = resolve('other.jsonl');
    },
    (value) => {
      value.journalPath = 'journal.jsonl';
    },
    (value) => {
      value.tools!.cwd = resolve('apps');
    },
    (value) => {
      value.tools!.artifactDir = resolve('other-artifacts');
    },
    (value) => {
      value.tools!.readDirs = [resolve('..')];
    },
    (value) => {
      value.permissionMode = 'full';
    },
    (value) => {
      value.model!.scope = { ...expected.scope, runId: 'other' };
    },
    (value) => {
      value.model!.input = undefined;
    },
    (value) => {
      value.tools!.verificationScope = { ...expected.scope, taskId: 'other' };
    },
    (value) => {
      value.extensionsScope = { ...expected.scope, projectId: 'other' };
    },
    (value) => {
      value.context!.pins = [];
    },
    (value) => {
      value.context!.pins = [{ ...value.context!.pins[0]!, origin: 'owner' }];
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(config);
    mutate(changed);
    expect(() => requireBuiltinTaskSessionPolicy(expected, changed)).toThrow();
  }
  expect(() =>
    requireBuiltinTaskSessionPolicy(
      {
        ...expected,
        scope: { ...expected.scope, importId: 'unexpected' },
      },
      config,
    ),
  ).toThrow('task/run scope');
});

it('cannot broaden a plan/read-only session or silently substitute its model/effort', () => {
  const { expected, config } = policy();
  for (const restriction of [{ planFirst: true }, { readOnly: true }]) {
    const restricted = { ...expected, options: { ...expected.options, ...restriction } };
    expect(() => requireBuiltinTaskSessionPolicy(restricted, config)).toThrow();
    expect(() =>
      requireBuiltinTaskSessionPolicy(restricted, {
        ...config,
        tools: { ...config.tools!, readOnly: true },
      }),
    ).not.toThrow();
  }
  const selected = { ...expected, options: { ...expected.options, model: 'route', effort: 'low' } };
  expect(() => requireBuiltinTaskSessionPolicy(selected, config)).toThrow('model or effort');
  config.route.parameters = { effort: 'low' };
  expect(() => requireBuiltinTaskSessionPolicy(selected, config)).not.toThrow();
  expect(() =>
    requireBuiltinTaskSessionPolicy(
      {
        ...selected,
        options: { ...selected.options, model: 'other' },
      },
      config,
    ),
  ).toThrow('model or effort');
});
