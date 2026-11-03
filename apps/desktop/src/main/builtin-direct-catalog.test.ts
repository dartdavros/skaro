import { expect, it } from 'vitest';
import { DEFAULT_UPSTREAM_POLICY, type RouteSnapshot } from '@skaro/timeline';
import {
  parseDirectCatalog,
  requireDirectCatalogRoute,
} from '../../../../packages/agent-runtime/src/models/direct-catalog';

// Pure API schema inputs. No HTTP server, credentials, project/run or model reply is created.
it('keeps missing metadata unknown and never infers capabilities from a model ID', () => {
  const [model] = parseDirectCatalog(
    [{ id: 'owner-selected-model', owned_by: 'organization' }],
    'direct',
    'openai',
  );
  expect(model).toMatchObject({
    manufacturer: null,
    family: null,
    pricing: { prompt: null, completion: null, request: null },
    capabilities: { tools: 'unknown', images: 'unknown', evidence: 'catalog', contextTokens: null },
  });
});

it('uses declared Claude and DeepSeek metadata and excludes explicitly retired models', () => {
  const [claude] = parseDirectCatalog(
    [
      {
        id: 'selected',
        display_name: 'Selected',
        line: 'explicit-line',
        max_input_tokens: 10000,
        max_tokens: 2000,
        capabilities: {
          image_input: { supported: true },
          thinking: { supported: false },
          effort: { supported: true, high: { supported: true }, low: { supported: false } },
        },
      },
      { id: 'retired', lifecycle: 'retired' },
    ],
    'direct',
    'anthropic',
  );
  expect(claude).toMatchObject({
    name: 'Selected',
    family: 'explicit-line',
    reasoning: { supportedEfforts: ['high'] },
    capabilities: {
      images: 'supported',
      reasoning: 'unsupported',
      contextTokens: 10000,
      outputTokens: 2000,
    },
  });
  const [deepseek] = parseDirectCatalog(
    [
      {
        id: 'selected',
        context_window: 12000,
        max_output_tokens: 4000,
        input_modalities: ['text'],
        effort: { supported_levels: ['low', 'high'], default_level: 'high' },
      },
    ],
    'direct',
    'deepseek',
  );
  expect(deepseek).toMatchObject({
    reasoning: { supportedEfforts: ['low', 'high'], defaultEffort: 'high' },
    capabilities: { images: 'unsupported', outputTokens: 4000 },
  });
  expect(() => parseDirectCatalog([{ id: 'same' }, { id: 'same' }], 'direct', 'openai')).toThrow();
  expect(() => parseDirectCatalog([{ id: 'invalid\nmodel' }], 'direct', 'openai')).toThrow();
});

it('checks profile, membership, request binding and advertised limits without claiming readiness', () => {
  const route: RouteSnapshot = {
    schema: 1,
    routeId: 'route',
    routeRevision: 1,
    connectionId: 'direct',
    connectionRevision: 1,
    connector: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    apiProfile: { id: 'anthropic.messages', revision: 1 },
    modelId: 'selected',
    parameters: { max_tokens: 1024 },
    upstream: DEFAULT_UPSTREAM_POLICY,
  };
  const models = parseDirectCatalog([{ id: 'selected', max_tokens: 2048 }], 'direct', 'anthropic');
  expect(requireDirectCatalogRoute(route, models).capabilities.tools).toBe('unknown');
  expect(() =>
    requireDirectCatalogRoute({ ...route, parameters: { max_tokens: 4096 } }, models),
  ).toThrow();
  expect(() => requireDirectCatalogRoute({ ...route, modelId: 'missing' }, models)).toThrow();
  expect(() =>
    requireDirectCatalogRoute(
      { ...route, apiProfile: { id: 'openai.responses', revision: 1 } },
      models,
    ),
  ).toThrow();
  expect(() =>
    requireDirectCatalogRoute(route, models, {
      kind: 'chat',
      value: { route, messages: [], price: { prompt: 0, completion: 0 } },
    }),
  ).toThrow();
});
