import type { RuntimeModelHost, CredentialReference } from '@skaro/timeline';
import { modelBinding, requireModelHostPolicy } from '@skaro/agent-runtime';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';

/** Bind current settings without replacing any existing request, credential, tool or budget policy. */
export function bindConfiguredModelHost(
  store: BuiltinModelConfigurationStore,
  original: RuntimeModelHost,
  credential: CredentialReference,
) {
  original.signal?.throwIfAborted();
  requireModelHostPolicy(original);
  const binding = modelBinding(original);
  const lease = store.admit(binding.route, credential);
  const close = () => {
    original.signal?.removeEventListener('abort', close);
    lease.close();
  };
  original.signal?.addEventListener('abort', close, { once: true });
  lease.signal.addEventListener(
    'abort',
    () => original.signal?.removeEventListener('abort', close),
    { once: true },
  );
  const signal = AbortSignal.any([lease.signal, ...(original.signal ? [original.signal] : [])]);
  const guard = async <T>(active: AbortSignal, work: (signal: AbortSignal) => Promise<T> | T) => {
    const combined = AbortSignal.any([active, signal]);
    combined.throwIfAborted();
    lease.requireCurrent(combined);
    const value = await work(combined);
    lease.requireCurrent(combined);
    return value;
  };
  const tools = original.toolAdmission;
  const input = original.input;
  const model: RuntimeModelHost = {
    ...binding,
    signal,
    input: input && {
      revision: input.revision,
      prepare: (value, active) => guard(active, (signal) => input.prepare(value, signal)),
      ...(input.steer
        ? {
            steer: (value, request, response, active) =>
              guard(active, (signal) => input.steer!(value, request, response, signal)),
          }
        : {}),
    },
    toolAdmission: tools && {
      revision: tools.revision,
      chatToolsRequired: tools.chatToolsRequired,
      rejectionMessage: tools.rejectionMessage,
      requireAllowed: (name, args, active = signal) =>
        guard(active, (signal) => tools.requireAllowed(name, args, signal)),
      projectResult: (result, active = signal) =>
        guard(active, (signal) => tools.projectResult(result, signal)),
      ...(tools.selectChatTools
        ? {
            selectChatTools: (catalogue, active = signal) =>
              guard(active, (signal) => tools.selectChatTools!(catalogue, signal)),
          }
        : {}),
    },
    reserve: (id, request, active) =>
      guard(active, (signal) => original.reserve(id, request, signal)),
    complete: (id, request, active, onText) =>
      guard(active, (signal) =>
        original.complete(id, request, signal, (text) => {
          lease.requireCurrent(signal);
          onText?.(text);
        }),
      ),
    ...(original.continue
      ? {
          continue: (request, response, results, active) =>
            guard(active, (signal) => original.continue!(request, response, results, signal)),
        }
      : {}),
  };
  // The same signal must also bind NativeSessionHost to revoke tools and the owned process tree.
  return { model, signal, close };
}
