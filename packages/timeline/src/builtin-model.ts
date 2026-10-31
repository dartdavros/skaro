/** Serializable, nonsecret configuration; model IDs are scoped to one connection. */
export interface CredentialReference {
  id: string;
  revision: number;
}

export interface ApiProfileReference {
  id: string;
  revision: number;
}

export interface ApiProfile extends ApiProfileReference {
  connector: string;
  protocol: 'responses' | 'messages' | 'chat-completions';
  /** BA-4 pins actual SDK dependencies and records real connector verification. */
  implementation: 'pending' | 'verified';
}

export interface UpstreamPolicy {
  /** No automatic fallback, even to another upstream, without an explicit policy. */
  selection: 'service-default' | 'restricted';
  allow: readonly string[];
  allowFallback: boolean;
  requireParameters: boolean;
  dataCollection: 'deny' | 'allow';
}

export type ModelParameters = Readonly<Record<string, string | number | boolean>>;

export interface Connection {
  id: string;
  revision: number;
  connector: string;
  endpoint: string;
  apiProfile: ApiProfileReference;
  credential: CredentialReference;
  /** Only connector schema-validated, nonsecret options; never arbitrary headers/env. */
  settings: ModelParameters;
  routing: UpstreamPolicy;
}

export type CapabilitySupport = 'unknown' | 'unsupported' | 'supported';
export interface RouteCapabilities {
  tools: CapabilitySupport;
  images: CapabilitySupport;
  reasoning: CapabilitySupport;
  parallelTools: CapabilitySupport;
  cache: CapabilitySupport;
  continuation: 'unknown' | 'none' | 'native';
  compaction: CapabilitySupport;
  contextTokens: number | null;
  outputTokens: number | null;
  evidence: 'unknown' | 'catalog' | 'verified';
}

export interface Model {
  connectionId: string;
  id: string;
  /** Metadata only: never used to choose a connector or infer identity. */
  manufacturer: string | null;
  family: string | null;
  capabilities: RouteCapabilities;
}

export interface Route {
  id: string;
  revision: number;
  connectionId: string;
  modelId: string;
  parameters: ModelParameters;
  upstream: UpstreamPolicy;
}

/** Exact request provenance. No credential reference, key, auth header or native state. */
export interface RouteSnapshot {
  schema: 1;
  routeId: string;
  routeRevision: number;
  connectionId: string;
  connectionRevision: number;
  connector: string;
  endpoint: string;
  apiProfile: ApiProfileReference;
  modelId: string;
  parameters: ModelParameters;
  upstream: UpstreamPolicy;
}

/** Verification belongs to this exact route/configuration, not a short model name. */
export interface RouteCapabilityAssessment {
  route: RouteSnapshot;
  capabilities: RouteCapabilities;
}

/** Only reported facts; null means the service did not supply that value. */
export interface ModelResponseProvenance {
  route: RouteSnapshot;
  actualModel: string | null;
  upstream: string | null;
  requestId: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
    reasoningTokens: number | null;
    cost: { amount: string; currency: string } | null;
  };
}
