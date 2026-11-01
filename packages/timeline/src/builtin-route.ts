import type {
  ApiProfile,
  Connection,
  Model,
  Route,
  RouteCapabilityAssessment,
  RouteSnapshot,
  UpstreamPolicy,
} from './builtin-model.ts';
import { BUILTIN_API_PROFILES } from './builtin-profiles.ts';

export function validateUpstreamPolicy(value: UpstreamPolicy): void {
  if (
    !['service-default', 'restricted'].includes(value.selection) ||
    !Array.isArray(value.allow) ||
    value.allow.some((id) => !id.trim()) ||
    new Set(value.allow).size !== value.allow.length ||
    (value.selection === 'restricted') !== value.allow.length > 0 ||
    typeof value.allowFallback !== 'boolean' ||
    typeof value.requireParameters !== 'boolean' ||
    !['deny', 'allow'].includes(value.dataCollection)
  )
    throw new Error('Invalid upstream policy');
}

/** Shared by configuration and request provenance; a route cannot widen its connection policy. */
export function requireUpstreamWithinConnection(connection: UpstreamPolicy, route: UpstreamPolicy) {
  validateUpstreamPolicy(connection);
  validateUpstreamPolicy(route);
  if (
    (!connection.allowFallback && route.allowFallback) ||
    (connection.requireParameters && !route.requireParameters) ||
    (connection.dataCollection === 'deny' && route.dataCollection !== 'deny') ||
    (connection.selection === 'restricted' &&
      (route.selection !== 'restricted' ||
        route.allow.some((id) => !connection.allow.includes(id))))
  )
    throw new Error('Route widens connection routing policy');
}

function revision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid configuration revision');
}

/** Credential-bearing URLs, query strings and fragments cannot enter request provenance. */
export function validateModelEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Model endpoint must be HTTPS without credentials, query or fragment');
}

/** Nonsecret configured identity only. This does not assert model availability or capabilities. */
export function configuredRouteSnapshot(
  route: Route,
  connections: readonly Connection[],
  profiles: readonly ApiProfile[] = BUILTIN_API_PROFILES,
): RouteSnapshot {
  if (!route.id || !route.modelId || !route.connectionId) throw new Error('Missing route identity');
  revision(route.revision);
  const matches = connections.filter((entry) => entry.id === route.connectionId);
  if (matches.length !== 1)
    throw new Error(`Unknown or ambiguous connection: ${route.connectionId}`);
  const connection = matches[0]!;
  revision(connection.revision);
  revision(connection.credential.revision);
  if (!connection.credential.id) throw new Error('Missing credential reference');
  const matchingProfiles = profiles.filter(
    (entry) =>
      entry.id === connection.apiProfile.id &&
      entry.revision === connection.apiProfile.revision &&
      entry.connector === connection.connector,
  );
  if (matchingProfiles.length !== 1) throw new Error('Unknown or incompatible API profile');
  validateModelEndpoint(connection.endpoint);
  requireUpstreamWithinConnection(connection.routing, route.upstream);
  return structuredClone({
    schema: 1,
    routeId: route.id,
    routeRevision: route.revision,
    connectionId: connection.id,
    connectionRevision: connection.revision,
    connector: connection.connector,
    endpoint: connection.endpoint,
    apiProfile: { id: connection.apiProfile.id, revision: connection.apiProfile.revision },
    modelId: route.modelId,
    parameters: route.parameters,
    upstream: route.upstream,
  });
}

/** Exact catalog lookup; disappearance never substitutes another model or connection. */
export function snapshotRoute(
  route: Route,
  connections: readonly Connection[],
  models: readonly Model[],
  profiles: readonly ApiProfile[] = BUILTIN_API_PROFILES,
): RouteSnapshot {
  const snapshot = configuredRouteSnapshot(route, connections, profiles);
  const matchingModels = models.filter(
    (entry) => entry.connectionId === snapshot.connectionId && entry.id === snapshot.modelId,
  );
  if (matchingModels.length !== 1) throw new Error(`Unknown or ambiguous model: ${route.modelId}`);
  return snapshot;
}

export type RequiredRouteCapability =
  'tools' | 'images' | 'reasoning' | 'parallelTools' | 'cache' | 'compaction' | 'continuation';

/** Catalog claims alone do not admit required operations. Never drop a parameter silently. */
export function requireRouteCapabilities(
  route: RouteSnapshot,
  assessment: RouteCapabilityAssessment,
  required: readonly RequiredRouteCapability[],
): void {
  for (const key of Object.keys(route) as (keyof RouteSnapshot)[]) {
    const normalize = (value: unknown) =>
      key === 'parameters'
        ? Object.fromEntries(Object.entries(value as object).sort(([a], [b]) => a.localeCompare(b)))
        : value;
    if (JSON.stringify(normalize(route[key])) !== JSON.stringify(normalize(assessment.route[key])))
      throw new Error('Route capability assessment is stale or belongs to another route');
  }
  const capabilities = assessment.capabilities;
  for (const key of required) {
    const supported =
      key === 'continuation' ? capabilities[key] === 'native' : capabilities[key] === 'supported';
    if (capabilities.evidence !== 'verified' || !supported)
      throw new Error(`Route capability not verified: ${key}`);
  }
}

/** BA-1 profiles describe the contract; they cannot admit model requests before BA-4. */
export function requireImplementedApiProfile(profile: ApiProfile): void {
  if (profile.implementation !== 'verified')
    throw new Error(`API profile not implemented: ${profile.id}`);
}
