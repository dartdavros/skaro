import { createHash } from 'node:crypto';
import type { RuntimeSession } from '../session.ts';
import { modelStep } from './model-step.ts';
import { executeModelTool, type ModelToolAdmission } from './model-tools.ts';
import type { ChatMessage, ChatRequest, ChatResponse } from './chat-types.ts';

interface ChatConnector {
  complete(
    request: ChatRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<ChatResponse>;
}

/** Internal bounded loop; product send/steer admission is intentionally a separate host boundary. */
interface ChatTurnInput {
  id: string;
  session: RuntimeSession;
  connector: ChatConnector;
  request: ChatRequest;
  signal: AbortSignal;
  maxSteps: number;
  /** Durable budget admission, invoked after intent and before sending bytes. */
  admitRequest(id: string, request: ChatRequest): Promise<void>;
  toolAdmission?: ModelToolAdmission;
  onText?: (text: string) => void;
}
const active = new WeakMap<
  RuntimeSession,
  { id: string; hash: string; work: Promise<ChatResponse> }
>();
export function executeChatTurn(input: ChatTurnInput): Promise<ChatResponse> {
  const snapshot = { ...input, request: structuredClone(input.request) };
  const hash = createHash('sha256')
    .update(JSON.stringify([snapshot.request, input.toolAdmission?.revision]))
    .digest('hex');
  const previous = active.get(input.session);
  if (previous)
    return previous.id === input.id && previous.hash === hash
      ? previous.work
      : Promise.reject(new Error('A different model turn is already active'));
  const work = input.session
    .runModel((signal) =>
      runChatTurn({ ...snapshot, signal: AbortSignal.any([input.signal, signal]) }),
    )
    .finally(() => active.delete(input.session));
  active.set(input.session, { id: input.id, hash, work });
  return work;
}

async function runChatTurn(input: ChatTurnInput): Promise<ChatResponse> {
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(input.id) ||
    !Number.isSafeInteger(input.maxSteps) ||
    input.maxSteps < 1 ||
    input.maxSteps > 100
  )
    throw new Error('Invalid model turn boundary');
  const { session, signal } = input;
  const journal = session.journal;
  const config = journal.state.config;
  if (!config || JSON.stringify(config.route) !== JSON.stringify(input.request.route))
    throw new Error('Model request route differs from the persisted session route');
  const request = structuredClone(input.request);
  const hash = createHash('sha256')
    .update(JSON.stringify([request, input.toolAdmission?.revision]))
    .digest('hex');
  const start = journal.find(`model-turn:${input.id}`);
  if (start && start.requestHash !== hash)
    throw new Error('Model turn identity reused for different input');
  if (!start) await journal.append(`model-turn:${input.id}`, [], {}, hash);
  const messages: ChatMessage[] = structuredClone(request.messages) as ChatMessage[];
  for (let step = 0; step < input.maxSteps; step++) {
    signal.throwIfAborted();
    if (journal.state.stopped || journal.state.closed)
      throw new Error('Model turn admission revoked');
    if (JSON.stringify(journal.state.config!.route) !== JSON.stringify(request.route))
      throw new Error('Model route changed during turn');
    const id = `model-${input.id}-${step}`;
    const response = await modelStep({
      id,
      name: 'model:chat',
      journal,
      request: { ...request, messages },
      route: request.route,
      signal,
      admit: input.admitRequest,
      generate: (current, signal) => input.connector.complete(current, signal, input.onText),
      continuation: (response) => ({ schema: 1, messages: [...messages, response.message] }),
    });
    messages.push(response.message);
    if (response.finishReason === 'stop') return response;
    const allowed = new Set(request.tools?.map((tool) => tool.name));
    for (const call of response.message.tool_calls ?? []) {
      signal.throwIfAborted();
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = undefined;
      }
      const result = await executeModelTool({
        stepId: id,
        session,
        signal,
        allowed,
        call: { id: call.id, name: call.function.name, arguments: args },
        admission: input.toolAdmission,
      });
      const content = JSON.stringify(
        input.toolAdmission && !result.error ? input.toolAdmission.projectResult(result) : result,
      );
      messages.push({ role: 'tool', tool_call_id: call.id, content });
      await journal.append(`${id}:tool:${call.id}`, [
        { type: 'continuation', route: request.route, value: { schema: 1, messages } },
      ]);
    }
  }
  throw new Error('Model turn step limit reached');
}
