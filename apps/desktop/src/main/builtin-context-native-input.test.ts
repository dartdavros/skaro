import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { RuntimeSession, appendNativeOwnerInput, toolCatalog } from '@skaro/agent-runtime';
import { BUILTIN_CONTRACT_VERSIONS, DEFAULT_UPSTREAM_POLICY } from '@skaro/timeline';
import type { RouteSnapshot } from '@skaro/timeline';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { refreshOwnerContext } from '../../../../packages/agent-runtime/src/context/owner-context';
import { ModelTurnTimeline } from '../../../../packages/agent-runtime/src/models/turn-timeline';
import { ownerInputRecord } from '../../../../packages/agent-runtime/src/models/owner-input-record';
import { openAIResponsesBody } from '../../../../packages/agent-runtime/src/models/openai';
import { anthropicMessagesBody } from '../../../../packages/agent-runtime/src/models/anthropic';
import { createContextNativeInput } from './builtin-context-native-input';

for (const connector of ['openai', 'anthropic'] as const) {
  it(`formats acknowledged ${connector} owner input from real journal/context without a provider response`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-native-owner-context-'));
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('skaro-native-owner-context-')
    )
      throw new Error('Unexpected native context verification directory');
    const route: RouteSnapshot = {
      schema: 1,
      routeId: 'format-only',
      routeRevision: 1,
      connectionId: 'not-connected',
      connectionRevision: 1,
      connector,
      endpoint:
        connector === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1',
      apiProfile: {
        id: connector === 'openai' ? 'openai.responses' : 'anthropic.messages',
        revision: 1,
      },
      modelId: 'not-requested',
      parameters: {},
      upstream: DEFAULT_UPSTREAM_POLICY,
    };
    const config = {
      sessionId: `owner-${connector}`,
      journalPath: join(directory, 'journal.jsonl'),
      permissionMode: 'ask' as const,
      versions: BUILTIN_CONTRACT_VERSIONS,
      route,
      tools: {
        cwd: resolve('.'),
        readDirs: [],
        readOnly: true,
        artifactDir: join(directory, 'artifacts'),
      },
      context: { scopePath: 'apps/desktop', pins: [], documents: [] },
    };
    const owner = {
      pid: process.pid,
      birth: (await processBirth(process.pid))!,
      platform: process.platform,
    };
    let session = await RuntimeSession.open(config, owner);
    try {
      const signal = new AbortController().signal;
      await refreshOwnerContext(session, 'fresh-owner', signal);
      // Actual input/lifecycle recording only: no fabricated model response or model host.
      const lifecycle = new ModelTurnTimeline(
        session.journal,
        'owner-format',
        'a'.repeat(64),
        'cmd:owner-input',
      );
      const { input, facts } = ownerInputRecord(
        {
          id: 'owner-input',
          action: { type: 'send', input: { text: 'Exact owner input\nwith newline\n' } },
        },
        lifecycle.turnId,
      );
      await lifecycle.begin(facts, { value: { kind: 'owner-input', mode: 'send' } });
      const read = toolCatalog().find((tool) => tool.name === 'read_file')!;
      const tools = [{ name: read.name, description: read.name, parameters: read.inputSchema }];
      const port = createContextNativeInput({ ...config, tools, maxSteps: 4 });
      expect(() => createContextNativeInput({ ...config, tools, maxSteps: 0 })).toThrow(
        'step limit',
      );
      expect(() =>
        createContextNativeInput({
          ...config,
          tools,
          maxSteps: 4,
          route: { ...route, apiProfile: { id: 'other', revision: 1 } },
        }),
      ).toThrow('explicit direct API profile');
      const formatted = await port.prepare(input, signal);
      expect(formatted.maxSteps).toBe(4);
      if (formatted.request.kind !== 'native') throw new Error('Expected native input');
      const request = formatted.request.value;
      expect(request.system).toContain('Без явного указания владельца');
      expect(request.system).toContain(JSON.stringify(input.input.text));
      expect(request.input.at(-1)).toEqual({ role: 'user', content: input.input.text });
      expect(request.context!.epoch).toBe(0);
      expect(request.tools).toEqual(tools);
      const body =
        connector === 'openai' ? openAIResponsesBody(request) : anthropicMessagesBody(request);
      expect(body[connector === 'openai' ? 'input' : 'messages']).toEqual(request.input);
      expect(body).not.toHaveProperty('previous_response_id');
      const changed = [
        { ...input, commandId: 'missing' },
        { ...input, id: 'other' },
        { ...input, turnId: 'other' },
        { ...input, timestamp: input.timestamp + 1 },
        { ...input, input: { text: 'Substitution' } },
        { ...input, input: { ...input.input, images: ['not-admitted.png'] } },
      ];
      for (const value of changed)
        await expect(port.prepare(value, signal)).rejects.toThrow('acknowledged');
      const previous = structuredClone(formatted.request);
      const steering = { ...input, mode: 'steer' as const, input: { text: 'Exact steering\n' } };
      const next = await appendNativeOwnerInput(steering, formatted.request, undefined, signal);
      expect(formatted.request).toEqual(previous);
      if (next.kind !== 'native') throw new Error('Expected native steering');
      expect(next.value.input).toEqual([
        ...request.input,
        { role: 'user', content: steering.input.text },
      ]);
      expect(next.value.system).toBe(request.system);
      expect(next.value.context).toEqual(request.context);
      await expect(
        appendNativeOwnerInput(input, formatted.request, undefined, signal),
      ).rejects.toThrow('incompatible');
      await expect(
        appendNativeOwnerInput(
          {
            ...steering,
            input: { ...steering.input, images: ['not-admitted.png'] },
          },
          formatted.request,
          undefined,
          signal,
        ),
      ).rejects.toThrow('incompatible');
      await session.dispose();
      session = await RuntimeSession.open(config, owner);
      expect(await port.prepare(input, signal)).toEqual(formatted);
      await expect(port.prepare(input, AbortSignal.abort())).rejects.toThrow();
      expect(session.journal.state.effects).toEqual({});
    } finally {
      await session.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
}
