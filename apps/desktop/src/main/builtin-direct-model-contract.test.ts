import { expect, it } from 'vitest';
import { DEFAULT_UPSTREAM_POLICY, type RouteSnapshot } from '@skaro/timeline';
import { toolCatalog } from '@skaro/agent-runtime';
import { openAIResponsesBody } from '../../../../packages/agent-runtime/src/models/openai';
import { anthropicMessagesBody } from '../../../../packages/agent-runtime/src/models/anthropic';
import { deepSeekBody } from '../../../../packages/agent-runtime/src/models/deepseek';
import { liveToolAdmission } from './credentials/live-tool-authority';

function route(connector: string, profile: string): RouteSnapshot {
  return {
    schema: 1,
    routeId: 'contract',
    routeRevision: 1,
    connectionId: 'contract',
    connectionRevision: 1,
    connector,
    endpoint: 'https://models.example.org/v1',
    apiProfile: { id: profile, revision: 1 },
    modelId: 'owner-selected-id',
    parameters: {},
    upstream: structuredClone(DEFAULT_UPSTREAM_POLICY),
  };
}
const read = toolCatalog().find((tool) => tool.name === 'read_file')!;
const tools = [
  { name: read.name, description: 'Read a scoped file', parameters: read.inputSchema },
];

it('builds stateless Responses requests with native items, explicit tools and strict parameter rejection', () => {
  const selected = route('openai', 'openai.responses');
  const input = [
    { role: 'user', content: [{ type: 'input_text', text: 'Check the admitted project scope.' }] },
  ];
  const body = openAIResponsesBody({ route: selected, input, tools });
  expect(body).toMatchObject({
    model: selected.modelId,
    input,
    store: false,
    truncation: 'disabled',
    include: ['reasoning.encrypted_content'],
    tools: [{ type: 'function', name: 'read_file', strict: false }],
  });
  expect(body).not.toHaveProperty('previous_response_id');
  expect(() =>
    openAIResponsesBody({ route: { ...selected, parameters: { api_key: 'not-a-key' } }, input }),
  ).toThrow('parameters');
  expect(() =>
    openAIResponsesBody({
      route: { ...selected, apiProfile: { id: 'anthropic.messages', revision: 1 } },
      input,
    }),
  ).toThrow('profile');
});

it('keeps Anthropic native messages and enforces explicit thinking budget/sampling compatibility', () => {
  const selected = route('anthropic', 'anthropic.messages');
  const input = [{ role: 'user', content: 'Check the admitted project scope.' }];
  const body = anthropicMessagesBody({ route: selected, input, tools });
  expect(body).toMatchObject({
    model: selected.modelId,
    messages: input,
    tools: [{ name: 'read_file', input_schema: read.inputSchema }],
  });
  expect(body).not.toHaveProperty('thinking');
  expect(() =>
    anthropicMessagesBody({
      route: { ...selected, parameters: { thinking: 'enabled', thinking_budget_tokens: 1024 } },
      input,
    }),
  ).toThrow('budget');
  expect(() =>
    anthropicMessagesBody({
      route: { ...selected, parameters: { thinking: 'adaptive', temperature: 0.5 } },
      input,
    }),
  ).toThrow('Sampling');
  expect(
    anthropicMessagesBody({
      route: {
        ...selected,
        parameters: { thinking: 'enabled', max_tokens: 2048, thinking_budget_tokens: 1024 },
      },
      input,
    }),
  ).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 1024 } });
});

it('uses the direct DeepSeek contract without gateway fields, implicit model changes or ignored sampling', () => {
  const selected = route('deepseek', 'deepseek.chat-completions');
  const messages = [{ role: 'user' as const, content: 'Check the admitted project scope.' }];
  const request = {
    route: { ...selected, parameters: { thinking: 'disabled', temperature: 0.2 } },
    messages,
    tools,
  };
  const body = deepSeekBody(request);
  expect(body).toMatchObject({
    model: selected.modelId,
    messages,
    thinking: { type: 'disabled' },
    temperature: 0.2,
  });
  expect(body).not.toHaveProperty('provider');
  expect(() =>
    deepSeekBody({ route: { ...selected, parameters: { temperature: 0.2 } }, messages }),
  ).toThrow('disabled thinking');
  expect(() =>
    deepSeekBody({
      route: { ...selected, parameters: { reasoning_effort: 'invented' } },
      messages,
    }),
  ).toThrow('parameters');
});

it('enforces the exact owner-approved live payload before file access', () => {
  expect(() =>
    liveToolAdmission.requireAllowed('read_file', { path: 'AGENTS.md', maxLines: 2 }),
  ).not.toThrow();
  for (const args of [
    { path: 'AGENTS.md', maxLines: 3 },
    { path: 'package.json', maxLines: 3, startLine: 2 },
    { path: '../package.json', maxLines: 1 },
    { path: '.skaro/config.yaml', maxLines: 1 },
  ])
    expect(() => liveToolAdmission.requireAllowed('read_file', args)).toThrow('Unapproved');
});
