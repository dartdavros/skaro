import { z } from 'zod';
import {
  BUILTIN_API_PROFILES,
  validateModelEndpoint,
  validateUpstreamPolicy,
  requireUpstreamWithinConnection,
} from '@skaro/timeline';
import type { BuiltinModelConfiguration } from '@skaro/timeline';
import { openRouterParameters } from './openrouter-request.ts';
import { openAIParameters } from './openai.ts';
import { anthropicParameters } from './anthropic.ts';
import { deepSeekParameters } from './deepseek.ts';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const parameters = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]));
const upstream = z.strictObject({
  selection: z.enum(['service-default', 'restricted']),
  allow: z.array(z.string().min(1).max(200)).max(64),
  allowFallback: z.boolean(),
  requireParameters: z.boolean(),
  dataCollection: z.enum(['deny', 'allow']),
});
const connection = z.strictObject({
  id,
  revision,
  connector: id,
  endpoint: z.string().min(1).max(2048),
  apiProfile: z.strictObject({ id: z.string().min(1).max(160), revision }),
  credential: z.strictObject({ id: z.uuid(), revision }),
  // No connector-specific connection options are implemented yet. Arbitrary headers/env are forbidden.
  settings: z.strictObject({}),
  routing: upstream,
});
const route = z.strictObject({
  id,
  revision,
  connectionId: id,
  modelId: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\p{Cc}\s]+$/u),
  parameters,
  upstream,
});
const choices = z.strictObject({
  connections: z.array(connection).max(64),
  routes: z.array(route).max(256),
});
const version = z.strictObject({ id, revision });
const baseState = choices.extend({
  schema: z.literal(1),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  connectionVersions: z.array(version).max(4096),
  routeVersions: z.array(version).max(8192),
});
const credential = z.strictObject({
  binding: z.strictObject({
    connectionId: id,
    connectionRevision: revision,
    endpoint: z.string().max(2048),
  }),
  reference: z.strictObject({ id: z.uuid(), revision }),
});
const state = baseState.extend({
  pendingCredential: z
    .strictObject({
      id: z.uuid(),
      connectionId: id,
      previous: credential.nullable(),
      next: credential.nullable(),
      nextState: baseState,
    })
    .optional(),
});
export type BuiltinModelConfigurationState = z.infer<typeof state>;
const validators: Record<string, (value: unknown) => unknown> = {
  'openrouter.chat-completions': openRouterParameters,
  'openai.responses': openAIParameters,
  'anthropic.messages': anthropicParameters,
  'deepseek.chat-completions': deepSeekParameters,
};
const unique = (items: readonly { id: string }[]) => {
  if (new Set(items.map((entry) => entry.id)).size !== items.length)
    throw new Error('Ambiguous builtin model configuration identity');
};
function requireChoices(value: Pick<BuiltinModelConfiguration, 'connections' | 'routes'>) {
  unique(value.connections);
  unique(value.routes);
  for (const item of value.connections) {
    validateModelEndpoint(item.endpoint);
    validateUpstreamPolicy(item.routing);
    const profile = BUILTIN_API_PROFILES.find(
      (profile) =>
        profile.id === item.apiProfile.id &&
        profile.revision === item.apiProfile.revision &&
        profile.connector === item.connector,
    );
    if (!profile || !validators[profile.id]) throw new Error('Unknown builtin model API profile');
    if (
      profile.connector !== 'openrouter' &&
      (item.routing.selection !== 'service-default' ||
        item.routing.allow.length ||
        item.routing.allowFallback)
    )
      throw new Error('Direct API does not implement gateway routing/fallback policy');
  }
  for (const item of value.routes) {
    const parent = value.connections.find((connection) => connection.id === item.connectionId);
    if (!parent) throw new Error('Configured route has no connection');
    requireUpstreamWithinConnection(parent.routing, item.upstream);
    if (
      parent.connector !== 'openrouter' &&
      (item.upstream.selection !== 'service-default' ||
        item.upstream.allow.length ||
        item.upstream.allowFallback)
    )
      throw new Error('Direct API does not implement gateway routing/fallback policy');
    validators[parent.apiProfile.id]!(item.parameters);
  }
}
export function parseBuiltinModelChoices(raw: unknown) {
  const parsed = choices.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid builtin model configuration');
  requireChoices(parsed.data);
  return parsed.data;
}
export function parseBuiltinConnectionDraft(raw: unknown) {
  const parsed = connection.omit({ credential: true }).safeParse(raw);
  if (!parsed.success) throw new Error('Invalid connection settings');
  return parsed.data;
}
export function parseBuiltinRoute(raw: unknown) {
  const parsed = route.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid model route settings');
  return parsed.data;
}
export function parseBuiltinModelConfiguration(raw: unknown): BuiltinModelConfigurationState {
  const parsed = state.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid or unsupported builtin model configuration');
  const value = parsed.data;
  if (Buffer.byteLength(JSON.stringify(value)) > 1_048_576)
    throw new Error('Builtin model configuration exceeds its storage limit');
  requireChoices(value);
  if (value.pendingCredential) {
    const pending = value.pendingCredential;
    if ((!pending.previous && !pending.next) || pending.nextState.revision !== value.revision + 1)
      throw new Error('Invalid pending credential configuration');
    requireChoices(pending.nextState);
    parseBuiltinModelConfiguration(pending.nextState);
    for (const item of [pending.previous, pending.next])
      if (item) {
        if (item.binding.connectionId !== pending.connectionId)
          throw new Error('Pending credential identity mismatch');
        validateModelEndpoint(item.binding.endpoint);
      }
    const target = pending.nextState.connections.find(
      (connection) => connection.id === pending.connectionId,
    );
    if (
      pending.next
        ? !target ||
          JSON.stringify(target.credential) !== JSON.stringify(pending.next.reference) ||
          target.endpoint !== pending.next.binding.endpoint ||
          target.revision !== pending.next.binding.connectionRevision
        : !!target
    )
      throw new Error('Pending credential does not match its target connection');
  }
  for (const [items, versions] of [
    [value.connections, value.connectionVersions],
    [value.routes, value.routeVersions],
  ] as const) {
    unique(versions);
    const byId = new Map(versions.map((entry) => [entry.id, entry.revision]));
    if (items.some((entry) => byId.get(entry.id) !== entry.revision))
      throw new Error('Builtin model configuration revisions are inconsistent');
  }
  return value;
}
