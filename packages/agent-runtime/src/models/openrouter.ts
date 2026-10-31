import type { CredentialPort } from '@skaro/timeline';
import type { ConnectorCredential } from './connector-auth.ts';
import { validateModelEndpoint } from '@skaro/timeline';
import type { ChatRequest, ChatResponse } from './chat-types.ts';
import { OpenRouterStream } from './openrouter-stream.ts';
import { openRouterBody } from './openrouter-request.ts';
import { serverEvents } from './sse.ts';
import { ModelSecretGuard } from './secret-guard.ts';
import { modelGetJson } from './model-get.ts';
import { ModelHttpError, modelFailure } from './model-error.ts';
export { ModelHttpError } from './model-error.ts';

/** Node-only native fetch transport; no SDK retry, redirect, provider fallback or secret logging. */
export class OpenRouterConnector {
  private readonly auth: ConnectorCredential;
  private readonly credentials: CredentialPort;
  constructor(credentials: CredentialPort, auth: ConnectorCredential) {
    validateModelEndpoint(auth.binding.endpoint);
    this.auth = structuredClone(auth);
    this.credentials = credentials;
  }

  async limits(
    signal: AbortSignal,
  ): Promise<{ usageUsd: number | null; remainingUsd: number | null }> {
    return this.credentials.withCredential({ ...this.auth, signal }, async (bytes, leaseSignal) => {
      const value = (await modelGetJson(
        `${this.auth.binding.endpoint.replace(/\/$/, '')}/key`,
        { Authorization: `Bearer ${Buffer.from(bytes).toString('ascii')}` },
        leaseSignal,
        65_536,
      )) as {
        data?: { usage?: number; limit_remaining?: number };
      };
      const amount = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
      return {
        usageUsd: amount(value.data?.usage),
        remainingUsd: amount(value.data?.limit_remaining),
      };
    });
  }

  async complete(
    input: ChatRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<ChatResponse> {
    const request = structuredClone(input);
    const body = JSON.stringify(openRouterBody(request));
    if (Buffer.byteLength(body) > 1_048_576)
      throw new Error('Model request exceeds the size limit');
    if (
      request.route.connectionId !== this.auth.binding.connectionId ||
      request.route.connectionRevision !== this.auth.binding.connectionRevision ||
      request.route.endpoint !== this.auth.binding.endpoint
    )
      throw new Error('Connector credential binding mismatch');
    let status: number | undefined;
    let phase = 'network';
    let diagnostic: ReturnType<typeof modelFailure> | undefined;
    try {
      return await this.credentials.withCredential(
        { ...this.auth, signal },
        async (bytes, leaseSignal) => {
          try {
            const key = Buffer.from(bytes).toString('ascii');
            const guard = new ModelSecretGuard(key);
            guard.requireSafe(body);
            const abort = AbortSignal.any([leaseSignal, AbortSignal.timeout(90_000)]);
            const response = await fetch(
              `${request.route.endpoint.replace(/\/$/, '')}/chat/completions`,
              {
                method: 'POST',
                redirect: 'error',
                signal: abort,
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body,
              },
            );
            if (!response.ok) {
              status = response.status;
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
            phase = 'stream';
            const stream = new OpenRouterStream();
            let done = false;
            for await (const data of serverEvents(response.body, abort)) {
              if (data === '[DONE]') {
                done = true;
                break;
              }
              const value: unknown = JSON.parse(data);
              guard.requireSafe(value);
              const output = stream.push(value);
              guard.requireSafe(stream.message);
              const safe = guard.text(output);
              if (safe) onText?.(safe);
            }
            abort.throwIfAborted();
            if (!done) throw new Error('Model stream ended without its terminal marker');
            const finishReason = stream.requireComplete();
            const tail = guard.text('', true);
            if (tail) onText?.(tail);
            guard.requireSafe(stream.native);
            return {
              message: stream.message,
              native: stream.native,
              finishReason,
              provenance: {
                route: request.route,
                actualModel: stream.actualModel,
                upstream: stream.upstream,
                requestId: stream.requestId,
                usage: stream.usage,
              },
            };
          } catch (failure) {
            diagnostic = modelFailure(failure);
            throw failure;
          }
        },
      );
    } catch {
      if (status !== undefined) throw new ModelHttpError(status);
      if (signal.aborted) throw new Error('Model request cancelled');
      if (diagnostic) throw diagnostic;
      // The credential boundary deliberately discards arbitrary provider/OS error messages.
      throw new Error(`Model request failed (${phase})`);
    }
  }
}

/** Public catalogue is evidence of advertised features, never proof of account/model availability. */
export async function openRouterCatalog(endpoint: string, signal: AbortSignal): Promise<unknown[]> {
  validateModelEndpoint(endpoint);
  const value = (await modelGetJson(
    `${endpoint.replace(/\/$/, '')}/models`,
    {},
    signal,
    16_777_216,
  )) as { data?: unknown[] };
  if (!Array.isArray(value.data)) throw new Error('Invalid model catalogue');
  return value.data;
}
