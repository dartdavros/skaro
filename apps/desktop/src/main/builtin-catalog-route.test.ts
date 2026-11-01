import { expect, it } from 'vitest';
import { requireOpenRouterCatalogRoute, type OpenRouterCatalogEntry } from '@skaro/agent-runtime';
import { DEFAULT_UPSTREAM_POLICY, type RouteSnapshot } from '@skaro/timeline';

// Pure metadata DTO contracts, not provider responses, fixtures or a substituted catalog API.
const route: RouteSnapshot = {
  schema: 1,
  routeId: 'contract',
  routeRevision: 1,
  connectionId: 'contract',
  connectionRevision: 1,
  connector: 'openrouter',
  endpoint: 'https://models.example.org/v1',
  apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
  modelId: 'exact-id',
  parameters: {},
  upstream: DEFAULT_UPSTREAM_POLICY,
};
const metadata: OpenRouterCatalogEntry = {
  connectionId: route.connectionId,
  id: route.modelId,
  name: 'Contract metadata',
  manufacturer: null,
  family: null,
  supportedParameters: ['max_tokens', 'temperature', 'reasoning'],
  pricing: { prompt: null, completion: null, request: null },
  reasoning: { supportedEfforts: ['low'] },
  capabilities: {
    tools: 'unknown',
    images: 'unknown',
    reasoning: 'unknown',
    parallelTools: 'unknown',
    cache: 'unknown',
    continuation: 'unknown',
    compaction: 'unknown',
    contextTokens: 8192,
    outputTokens: 2048,
    evidence: 'catalog',
  },
};

it('requires exact unambiguous model identity and leaves evidence/readiness unchanged', () => {
  const result = requireOpenRouterCatalogRoute(route, [metadata]);
  expect(result).toEqual(metadata);
  result.supportedParameters.length = 0;
  expect(metadata.supportedParameters).toContain('max_tokens');
  expect(result.capabilities.evidence).toBe('catalog');
  for (const models of [[], [metadata, metadata], [{ ...metadata, connectionId: 'other' }]])
    expect(() => requireOpenRouterCatalogRoute(route, models)).toThrow('absent or ambiguous');
  expect(() =>
    requireOpenRouterCatalogRoute({ ...route, connector: 'openai' }, [metadata]),
  ).toThrow('API profile');
});

it('checks formatter defaults, parameter mapping and token ceilings without silently dropping options', () => {
  expect(() =>
    requireOpenRouterCatalogRoute(route, [
      {
        ...metadata,
        supportedParameters: ['max_completion_tokens'],
      },
    ]),
  ).not.toThrow();
  const reasoning = { ...route, parameters: { reasoning_effort: 'low' } };
  expect(() => requireOpenRouterCatalogRoute(reasoning, [metadata])).not.toThrow();
  expect(() =>
    requireOpenRouterCatalogRoute({ ...route, parameters: { reasoning_effort: 'max' } }, [
      {
        ...metadata,
        reasoning: { supportedEfforts: null },
      },
    ]),
  ).not.toThrow();
  expect(() =>
    requireOpenRouterCatalogRoute({ ...route, parameters: { reasoning_effort: 'high' } }, [
      metadata,
    ]),
  ).toThrow('effort is not advertised');
  expect(() =>
    requireOpenRouterCatalogRoute({ ...route, parameters: { reasoning_effort: 'none' } }, [
      {
        ...metadata,
        reasoning: { supportedEfforts: null, mandatory: true },
      },
    ]),
  ).toThrow('effort is not advertised');
  for (const selected of [route, { ...route, parameters: { temperature: 0 } }, reasoning])
    expect(() =>
      requireOpenRouterCatalogRoute(selected, [{ ...metadata, supportedParameters: [] }]),
    ).toThrow('not advertised');
  for (const capabilities of [
    { ...metadata.capabilities, outputTokens: 512 },
    { ...metadata.capabilities, outputTokens: null, contextTokens: 512 },
  ])
    expect(() => requireOpenRouterCatalogRoute(route, [{ ...metadata, capabilities }])).toThrow(
      'token limits',
    );
  expect(() =>
    requireOpenRouterCatalogRoute({ ...route, parameters: { invented: 1 } }, [metadata]),
  ).toThrow('parameters');
});

it('checks request route and tools independently of catalog reasoning or verified operation admission', () => {
  const request = {
    kind: 'chat' as const,
    value: {
      route,
      messages: [{ role: 'user' as const, content: 'Contract input' }],
      tools: [{ name: 'scoped-tool', description: 'Contract tool', parameters: {} }],
      price: { prompt: 0, completion: 0 },
    },
  };
  expect(() => requireOpenRouterCatalogRoute(route, [metadata], request)).toThrow(
    'tools are not advertised',
  );
  const advertised = {
    ...metadata,
    supportedParameters: [...metadata.supportedParameters, 'tools', 'tool_choice'],
    capabilities: { ...metadata.capabilities, tools: 'supported' as const },
  };
  expect(() => requireOpenRouterCatalogRoute(route, [advertised], request)).not.toThrow();
  expect(() =>
    requireOpenRouterCatalogRoute(
      route,
      [
        {
          ...advertised,
          supportedParameters: advertised.supportedParameters.filter(
            (name) => name !== 'tool_choice',
          ),
        },
      ],
      request,
    ),
  ).toThrow('tools are not advertised');
  expect(() =>
    requireOpenRouterCatalogRoute(route, [advertised], {
      ...request,
      value: { ...request.value, route: { ...route, routeRevision: 2 } },
    }),
  ).toThrow('differs');
});
