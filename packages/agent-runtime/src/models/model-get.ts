import { setTimeout as delay } from 'node:timers/promises';
import { boundedJson } from './json-body.ts';
import { ModelHttpError } from './model-error.ts';

/** Retry only idempotent metadata GETs. Model POSTs/tool effects never enter this helper. */
export async function modelGetJson(
  url: string | URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  limit: number,
): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, {
      redirect: 'error',
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (response.ok) return boundedJson(response, limit);
    await response.body?.cancel();
    if (attempt === 2 || ![429, 502, 503, 504].includes(response.status))
      throw new ModelHttpError(response.status);
    const header = response.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    const requested = Number.isFinite(seconds)
      ? seconds * 1000
      : header
        ? Date.parse(header) - Date.now()
        : NaN;
    const wait = Math.max(
      0,
      Math.min(5000, Number.isFinite(requested) ? requested : 150 * 2 ** attempt),
    );
    await delay(wait, undefined, { signal });
  }
  throw new Error('Model metadata retry limit exceeded');
}
