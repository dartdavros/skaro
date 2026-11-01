import type { ModelResponseProvenance, RouteSnapshot } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import { ModelHttpError, ModelProtocolError } from './model-error.ts';

/** One durable request; a missing successful result never authorizes retransmitting a POST. */
export async function modelStep<Q, R extends { provenance: ModelResponseProvenance }>(input: {
  id: string;
  name: string;
  journal: RuntimeJournal;
  request: Q;
  route: RouteSnapshot;
  signal: AbortSignal;
  admit(id: string, request: Q, signal: AbortSignal): Promise<void>;
  generate(request: Q, signal: AbortSignal): Promise<R>;
  continuation(response: R): unknown;
}): Promise<R> {
  const { id, journal, signal } = input;
  const completed = journal.find(`${id}:result`);
  if (completed) {
    if (completed.result.error || !completed.result.value)
      throw new Error('Prior model request failed; explicit new input required');
    return structuredClone(completed.result.value) as R;
  }
  if (journal.find(`${id}:intent`))
    throw new Error('Prior model request has no successful result; automatic replay forbidden');
  await journal.append(`${id}:intent`, [{ type: 'effect-intent', id, name: input.name }]);
  let admitted = false;
  try {
    await input.admit(id, structuredClone(input.request), signal);
    signal.throwIfAborted();
    admitted = true;
    const response = await input.generate(input.request, signal);
    signal.throwIfAborted();
    if (JSON.stringify(response.provenance.route) !== JSON.stringify(input.route))
      throw new Error('Model response route differs from request');
    await journal.append(
      `${id}:result`,
      [
        { type: 'effect-result', id, result: response.provenance },
        { type: 'continuation', route: input.route, value: input.continuation(response) },
      ],
      { value: response },
    );
    return response;
  } catch (failure) {
    const rejected =
      failure instanceof ModelHttpError &&
      failure.status >= 400 &&
      failure.status < 500 &&
      failure.status !== 408;
    const detail = failure instanceof ModelProtocolError ? ` (${failure.message})` : '';
    const reason = rejected
      ? `Model request rejected (HTTP ${failure.status}); not retried`
      : admitted
        ? `Model request failed with unknown outcome; not retried${detail}`
        : 'Model request not admitted';
    await journal.append(
      `${id}:failed`,
      admitted && !rejected
        ? [{ type: 'effect-unknown', id }]
        : [{ type: 'effect-result', id, result: { error: reason } }],
      { error: reason },
    );
    // eslint-disable-next-line preserve-caught-error -- Never retain arbitrary provider/OS payloads as an error cause.
    throw new Error(reason);
  }
}
