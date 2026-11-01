import { validateModelEndpoint, type CredentialPort, type RouteSnapshot } from '@skaro/timeline';
import type { ConnectorCredential } from './connector-auth.ts';
import { serverEvents } from './sse.ts';
import { modelGetJson, type ModelFetch } from './model-get.ts';
import { ModelSecretGuard } from './secret-guard.ts';
import { ModelHttpError, modelFailure } from './model-error.ts';

export interface NativeStream<T> {
  push(value: unknown): string;
  snapshot(): unknown;
  complete: boolean;
  finish(requestId: string | null): T;
}
type Authentication = 'bearer' | 'anthropic';
function headers(authentication: Authentication, key: string): Record<string, string> {
  return authentication === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function requireBinding(auth: ConnectorCredential, route: RouteSnapshot): void {
  validateModelEndpoint(route.endpoint);
  if (
    route.connectionId !== auth.binding.connectionId ||
    route.connectionRevision !== auth.binding.connectionRevision ||
    route.endpoint !== auth.binding.endpoint
  )
    throw new Error('Connector credential binding mismatch');
}

/** One POST only. Cancellation, redirects and partial streams never trigger another model step. */
export async function nativeModelStream<T>(input: {
  credentials: CredentialPort;
  auth: ConnectorCredential;
  route: RouteSnapshot;
  path: 'responses' | 'messages' | 'chat/completions';
  authentication: Authentication;
  body: Record<string, unknown>;
  stream: NativeStream<T>;
  signal: AbortSignal;
  doneMarker?: boolean;
  onText?: (text: string) => void;
  load?: ModelFetch;
}): Promise<T> {
  const auth = structuredClone(input.auth);
  const route = structuredClone(input.route);
  requireBinding(auth, route);
  const body = JSON.stringify(input.body);
  if (Buffer.byteLength(body) > 1_048_576) throw new Error('Model request exceeds the size limit');
  let diagnostic: ReturnType<typeof modelFailure> | undefined;
  try {
    return await input.credentials.withCredential(
      { ...auth, signal: input.signal },
      async (bytes, leaseSignal) => {
        try {
          const key = Buffer.from(bytes).toString('ascii');
          const guard = new ModelSecretGuard(key);
          guard.requireSafe(body);
          const signal = AbortSignal.any([leaseSignal, AbortSignal.timeout(90_000)]);
          const response = await (input.load ?? fetch)(
            `${route.endpoint.replace(/\/$/, '')}/${input.path}`,
            {
              method: 'POST',
              redirect: 'error',
              signal,
              headers: headers(input.authentication, key),
              body,
            },
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new ModelHttpError(response.status);
          }
          if (
            !response.headers.get('content-type')?.includes('text/event-stream') ||
            !response.body
          ) {
            await response.body?.cancel();
            throw new Error('Model service did not return an event stream');
          }
          let marker = false;
          for await (const data of serverEvents(response.body, signal)) {
            if (input.doneMarker && data === '[DONE]') {
              marker = true;
              break;
            }
            const value: unknown = JSON.parse(data);
            guard.requireSafe(value);
            const text = input.stream.push(value);
            guard.requireSafe(input.stream.snapshot());
            const safe = guard.text(text);
            if (safe) input.onText?.(safe);
            if (!input.doneMarker && input.stream.complete) break;
          }
          signal.throwIfAborted();
          if (input.doneMarker && !marker)
            throw new Error('Model stream ended without its terminal marker');
          const result = input.stream.finish(
            response.headers.get('x-request-id') ?? response.headers.get('request-id'),
          );
          guard.requireSafe(result);
          const tail = guard.text('', true);
          if (tail) input.onText?.(tail);
          return result;
        } catch (error) {
          diagnostic = modelFailure(error);
          throw error;
        }
      },
    );
  } catch {
    if (input.signal.aborted) throw new Error('Model request cancelled');
    throw diagnostic ?? new Error('Model credential admission failed');
  }
}

/** Authenticated native catalogue; explicit pagination, bounded body, no model substitution. */
export async function nativeCatalog(
  credentials: CredentialPort,
  auth: ConnectorCredential,
  authentication: Authentication,
  signal: AbortSignal,
  load?: ModelFetch,
): Promise<Record<string, unknown>[]> {
  auth = structuredClone(auth);
  validateModelEndpoint(auth.binding.endpoint);
  return credentials.withCredential(
    { ...structuredClone(auth), signal },
    async (bytes, leaseSignal) => {
      const guard = new ModelSecretGuard(Buffer.from(bytes).toString('ascii'));
      const result: Record<string, unknown>[] = [];
      let after: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const url = new URL(`${auth.binding.endpoint.replace(/\/$/, '')}/models`);
        if (after) url.searchParams.set('after_id', after);
        const value = (await modelGetJson(
          url,
          headers(authentication, Buffer.from(bytes).toString('ascii')),
          leaseSignal,
          16_777_216,
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
        if (!value.has_more) return result;
        if (authentication !== 'anthropic' || !value.last_id || seen.has(value.last_id))
          throw new Error('Unsupported or cyclic model catalogue pagination');
        seen.add(value.last_id);
        after = value.last_id;
      }
      throw new Error('Model catalogue page limit exceeded');
    },
  );
}
