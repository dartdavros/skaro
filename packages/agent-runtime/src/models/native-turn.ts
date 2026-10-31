import { createHash } from 'node:crypto';
import type { RuntimeSession } from '../session.ts';
import { modelStep } from './model-step.ts';
import { executeModelTool, type ModelToolAdmission } from './model-tools.ts';
import type { NativeRequest, NativeResponse, NativeToolResult } from './native-types.ts';

interface NativeConnector {
  complete(
    request: NativeRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<NativeResponse>;
  continue(
    request: NativeRequest,
    response: NativeResponse,
    results: readonly NativeToolResult[],
  ): NativeRequest;
}
interface NativeTurnInput {
  id: string;
  session: RuntimeSession;
  connector: NativeConnector;
  request: NativeRequest;
  signal: AbortSignal;
  maxSteps: number;
  admitRequest(id: string, request: NativeRequest): Promise<void>;
  toolAdmission?: ModelToolAdmission;
  onText?: (text: string) => void;
}
const active = new WeakMap<
  RuntimeSession,
  { id: string; hash: string; work: Promise<NativeResponse> }
>();

/** Same durable model-step/tool executor as Chat; provider continuation remains native. */
export function executeNativeTurn(input: NativeTurnInput): Promise<NativeResponse> {
  const request = structuredClone(input.request);
  const hash = createHash('sha256')
    .update(JSON.stringify([request, input.toolAdmission?.revision]))
    .digest('hex');
  const previous = active.get(input.session);
  if (previous)
    return previous.id === input.id && previous.hash === hash
      ? previous.work
      : Promise.reject(new Error('A different native model turn is already active'));
  const work = input.session
    .runModel((signal) =>
      run({ ...input, request, signal: AbortSignal.any([signal, input.signal]) }, hash),
    )
    .finally(() => active.delete(input.session));
  active.set(input.session, { id: input.id, hash, work });
  return work;
}
async function run(input: NativeTurnInput, hash: string): Promise<NativeResponse> {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ||
    !Number.isSafeInteger(input.maxSteps) ||
    input.maxSteps < 1 ||
    input.maxSteps > 100
  )
    throw new Error('Invalid native model turn boundary');
  const { session, signal } = input;
  const journal = session.journal;
  let request = structuredClone(input.request);
  const turnId = `native-turn:${input.id}`;
  const previous = journal.find(turnId);
  if (previous && previous.requestHash !== hash)
    throw new Error('Native model turn identity reused for different input');
  const requireRoute = () => {
    signal.throwIfAborted();
    if (journal.state.stopped || journal.state.closed)
      throw new Error('Model turn admission revoked');
    if (
      JSON.stringify(journal.state.config?.route) !== JSON.stringify(input.request.route) ||
      JSON.stringify(request.route) !== JSON.stringify(input.request.route)
    )
      throw new Error('Native model route changed during turn');
  };
  requireRoute();
  if (!previous) await journal.append(turnId, [], {}, hash);
  const allowed = new Set(request.tools?.map((tool) => tool.name));
  for (let step = 0; step < input.maxSteps; step++) {
    if (session.context) {
      if (!request.context) throw new Error('Configured context selection is required');
      await session.context.requireCurrent(request.context.revision, request.context.epoch, signal);
    }
    requireRoute();
    const id = `native-${input.id}-${step}`;
    const response = await modelStep({
      id,
      name: `model:${request.route.apiProfile.id}`,
      journal,
      request,
      route: request.route,
      signal,
      admit: input.admitRequest,
      generate: (request, signal) => input.connector.complete(request, signal, input.onText),
      continuation: (response) => ({
        schema: 1,
        protocol: request.route.apiProfile,
        input: request.input,
        response,
      }),
    });
    if (!response.calls.length) return response;
    const results: NativeToolResult[] = [];
    for (const call of response.calls) {
      const result = await executeModelTool({
        stepId: id,
        session,
        signal,
        allowed,
        call,
        admission: input.toolAdmission,
      });
      results.push({
        id: call.id,
        text: JSON.stringify(
          input.toolAdmission && !result.error ? input.toolAdmission.projectResult(result) : result,
        ),
        ...(result.error ? { isError: true } : {}),
      });
      await journal.append(`${id}:tool:${call.id}`, [
        {
          type: 'continuation',
          route: request.route,
          value: {
            schema: 1,
            protocol: request.route.apiProfile,
            input: request.input,
            response,
            results,
          },
        },
      ]);
    }
    request = input.connector.continue(request, response, results);
  }
  throw new Error('Native model turn step limit reached');
}
