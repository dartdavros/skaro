import type {
  RuntimeModelHost,
  RuntimeModelRpcRequest,
  RuntimeModelRpcReply,
  ModelTool,
  NativeRequest,
  NativeResponse,
  NativeToolResult,
} from '@skaro/timeline';
import { z } from 'zod';
import { RuntimeRpcServer } from '../rpc/server.ts';
import { MODEL_RPC_LIMITS } from '../rpc/limits.ts';
import { fingerprint } from '../verification/inputs.ts';
import { readRuntimeJournal } from '../journal-reader.ts';
import { modelBinding, requireModelHostPolicy } from './host-binding.ts';
import { requireModelIntent } from './host-gate.ts';
import { ModelHttpError } from './model-error.ts';
import { modelInvocation, modelToolSchema, preparedModelTurn } from './host-schemas.ts';
import { requireOwnerInput } from './owner-input-gate.ts';
import { requireOwnerSteering } from './owner-steer-host.ts';

/** Only this privileged host calls the original connector. A peer never receives credential bytes. */
export class ModelServer {
  private readonly rpc: RuntimeRpcServer;
  private readonly reservations = new Map<
    string,
    { hash: string; work: Promise<Record<string, unknown>> }
  >();
  private readonly dispatched = new Set<string>();
  private readonly prepared = new Map<string, Promise<unknown>>();
  private readonly steered = new Map<string, { hash: string; work: Promise<unknown> }>();
  constructor(
    host: RuntimeModelHost,
    send: (reply: RuntimeModelRpcReply) => void,
    requireOwner: (signal: AbortSignal) => Promise<void>,
  ) {
    requireModelHostPolicy(host);
    const binding = modelBinding(host);
    const policy = host.toolAdmission;
    this.rpc = new RuntimeRpcServer({
      requireOwner,
      signal: host.signal,
      limits: MODEL_RPC_LIMITS,
      send: (reply) =>
        send(
          reply.type === 'runtime-rpc-progress'
            ? { type: 'model-rpc-text', id: reply.id, text: reply.text }
            : { ...reply, type: 'model-rpc-result' },
        ),
      dispatch: async (operation, raw, signal, onText) => {
        if (operation === 'steer-input') {
          if (!host.input?.steer || !binding.policy.input?.steer)
            throw new Error('Active owner steering is not configured');
          const { input, request, terminal } = await requireOwnerSteering(binding, raw);
          signal.throwIfAborted();
          const hash = fingerprint({ request, terminal });
          const previous = this.steered.get(input.commandId);
          if (previous) {
            if (previous.hash !== hash) throw new Error('Steering preparation identity conflict');
            return previous.work;
          }
          if (this.steered.size >= 1024) throw new Error('Steering preparation limit reached');
          const work = Promise.resolve().then(async () => {
            const value = await host.input!.steer!(input, request, terminal, signal);
            modelInvocation.shape.request.parse(value);
            if (
              value.kind !== binding.policy.protocol ||
              fingerprint(value.value.route) !== fingerprint(binding.route)
            )
              throw new Error('Steering cannot change its model route');
            return structuredClone(value);
          });
          this.steered.set(input.commandId, { hash, work });
          return work;
        }
        if (operation === 'prepare-input') {
          if (!host.input) throw new Error('Owner input preparation is not configured');
          const id = z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,160}$/)
            .parse(raw);
          const input = await requireOwnerInput(binding, id);
          signal.throwIfAborted();
          const previous = this.prepared.get(id);
          if (previous) return previous;
          if (this.prepared.size >= 1024) throw new Error('Owner input preparation limit reached');
          const work = Promise.resolve().then(async () => {
            const value = await host.input!.prepare(input, signal);
            preparedModelTurn.parse(value);
            if (
              value.request.kind !== binding.policy.protocol ||
              fingerprint(value.request.value.route) !== fingerprint(binding.route)
            )
              throw new Error('Prepared owner request differs from its admitted route');
            return structuredClone(value);
          });
          this.prepared.set(id, work);
          return work;
        }
        if (operation === 'select-tools') {
          if (!policy?.selectChatTools || !Array.isArray(raw))
            throw new Error('Unconfigured model selector');
          z.array(modelToolSchema).max(128).parse(raw);
          return policy.selectChatTools(structuredClone(raw) as ModelTool[], signal);
        }
        if (operation === 'allow-tool') {
          if (!policy) throw new Error('Unconfigured model tool admission');
          const args = z.strictObject({ name: z.string().max(200), args: z.unknown() }).parse(raw);
          await policy.requireAllowed(args.name, args.args, signal);
          return null;
        }
        if (operation === 'project-tool') {
          if (!policy) throw new Error('Unconfigured model result projection');
          return policy.projectResult(
            z
              .strictObject({ value: z.unknown().optional(), error: z.string().optional() })
              .parse(raw),
            signal,
          );
        }
        if (operation === 'continue') {
          if (!host.continue || binding.policy.protocol !== 'native')
            throw new Error('Unconfigured native continuation');
          const args = z
            .strictObject({
              request: z.record(z.string(), z.unknown()),
              response: z.record(z.string(), z.unknown()),
              results: z.array(z.record(z.string(), z.unknown())).max(64),
            })
            .parse(raw);
          const request = args.request as unknown as NativeRequest;
          const response = args.response as unknown as NativeResponse;
          if (
            fingerprint(request.route) !== fingerprint(binding.route) ||
            fingerprint(response.provenance?.route) !== fingerprint(binding.route)
          )
            throw new Error('Native continuation route mismatch');
          return host.continue(
            request,
            response,
            args.results as unknown as NativeToolResult[],
            signal,
          );
        }
        const parsed = modelInvocation.parse(raw);
        // Validation must not reorder the reviewed request/schema bytes or change its hash.
        const request = structuredClone((raw as typeof parsed).request);
        await requireModelIntent(binding, parsed.id, request, operation === 'complete');
        signal.throwIfAborted();
        if (operation === 'reserve') {
          const hash = fingerprint(request);
          const previous = this.reservations.get(parsed.id);
          if (previous) {
            if (previous.hash !== hash) throw new Error('Model reservation identity conflict');
            return previous.work;
          }
          if (this.reservations.size >= 1024)
            throw new Error('Model lease reservation limit reached');
          const work = Promise.resolve().then(async () => {
            const value = await host.reserve(parsed.id, request, signal);
            if (
              !value ||
              typeof value !== 'object' ||
              Buffer.byteLength(JSON.stringify(value)) > 16_384
            )
              throw new Error('Invalid model reservation');
            return structuredClone(value);
          });
          this.reservations.set(parsed.id, { hash, work });
          return work;
        }
        if (operation !== 'complete' || this.dispatched.has(parsed.id))
          throw new Error('Model request cannot be repeated');
        const reserved = this.reservations.get(parsed.id);
        if (!reserved || reserved.hash !== fingerprint(request))
          throw new Error('Model request is not reserved');
        const quote = await reserved.work;
        const journal = await readRuntimeJournal(binding.journalPath, binding.admission.sessionId);
        if (
          fingerprint(
            journal.records.find((record) => record.id === `budget:${parsed.id}`)?.result.value,
          ) !== fingerprint(quote)
        )
          throw new Error('Model reservation differs from the durable quote');
        signal.throwIfAborted();
        // Other calls can cross the asynchronous reservation/journal reads above.
        if (this.dispatched.has(parsed.id)) throw new Error('Model request cannot be repeated');
        this.dispatched.add(parsed.id);
        try {
          const response = await host.complete(parsed.id, request, signal, onText);
          if (
            response.kind !== request.kind ||
            fingerprint(response.value.provenance.route) !== fingerprint(binding.route)
          )
            throw new Error('Model response binding mismatch');
          return { outcome: 'completed', response };
        } catch (error) {
          if (
            error instanceof ModelHttpError &&
            Number.isInteger(error.status) &&
            error.status >= 400 &&
            error.status <= 599
          )
            return { outcome: 'http-error', status: error.status };
          // eslint-disable-next-line preserve-caught-error -- Never forward provider/credential error payloads or causes through IPC.
          throw new Error('Model host completion has no confirmed result');
        }
      },
    });
  }
  receive(request: RuntimeModelRpcRequest): void {
    this.rpc.receive(
      request.type === 'model-rpc-cancel'
        ? { type: 'runtime-rpc-cancel', id: request.id }
        : { ...request, type: 'runtime-rpc-call' },
    );
  }
  async close(): Promise<void> {
    this.rpc.close();
    await this.rpc.drain();
  }
}
