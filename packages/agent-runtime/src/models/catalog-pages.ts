import { validateModelEndpoint } from '@skaro/timeline';
import { modelGetJson, type ModelFetch } from './model-get.ts';
import { ModelSecretGuard } from './secret-guard.ts';
import { modelHeaders, type ModelAuthentication } from './model-headers.ts';

/** Reuses the connector's metadata protocol without inventing a model process admission. */
export async function authenticatedCatalog(
  endpoint: string,
  authentication: ModelAuthentication,
  bytes: Uint8Array,
  signal: AbortSignal,
  load?: ModelFetch,
): Promise<Record<string, unknown>[]> {
  validateModelEndpoint(endpoint);
  const key = Buffer.from(bytes).toString('ascii'),
    guard = new ModelSecretGuard(key);
  const result: Record<string, unknown>[] = [],
    seen = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    signal.throwIfAborted();
    const url = new URL(`${endpoint.replace(/\/$/, '')}/models`);
    if (after) url.searchParams.set('after_id', after);
    const value = (await modelGetJson(
      url,
      modelHeaders(authentication, key),
      signal,
      16777216,
      load,
    )) as {
      data?: Record<string, unknown>[];
      has_more?: boolean;
      last_id?: string;
    };
    guard.requireSafe(value);
    if (!Array.isArray(value.data) || value.data.some((model) => typeof model?.id !== 'string'))
      throw new Error('Invalid model catalogue');
    result.push(...value.data);
    if (result.length > 10000) throw new Error('Model catalogue entry limit exceeded');
    if (!value.has_more) return result;
    if (authentication !== 'anthropic' || !value.last_id || seen.has(value.last_id))
      throw new Error('Unsupported or cyclic model catalogue pagination');
    seen.add(value.last_id);
    after = value.last_id;
  }
  throw new Error('Model catalogue page limit exceeded');
}
