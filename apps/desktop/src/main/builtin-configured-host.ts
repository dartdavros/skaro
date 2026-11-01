import type { ModelFetch } from '@skaro/agent-runtime';
import type {
  ModelToolAdmission,
  ProcessAdmissionPort,
  RuntimeModelBinding,
  RuntimeModelHost,
  RuntimeModelInputPort,
  RuntimeModelRequest,
  RouteSnapshot,
} from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import type { BuiltinModelSettingsService } from './builtin-model-settings-service';
import { builtinModelConnector } from './builtin-model-connector';
import { bindConfiguredModelHost } from './builtin-configured-model-host';

/** Privileged composition only: caller supplies current catalog/readiness, payload and budget gates. */
export async function prepareConfiguredModelHost(input: {
  store: BuiltinModelConfigurationStore;
  settings: BuiltinModelSettingsService;
  binding: RuntimeModelBinding;
  admissions: Pick<ProcessAdmissionPort, 'requireActive'>;
  signal: AbortSignal;
  transport: ModelFetch;
  metadata: {
    requireCurrent(
      route: RouteSnapshot,
      request: RuntimeModelRequest | undefined,
      signal: AbortSignal,
    ): Promise<void>;
  };
  ownerInput?: RuntimeModelInputPort;
  toolAdmission?: ModelToolAdmission;
  requests: {
    reserve: RuntimeModelHost['reserve'];
    requireDispatch(id: string, request: RuntimeModelRequest, signal: AbortSignal): Promise<void>;
  };
}) {
  const binding = structuredClone(input.binding);
  input.signal.throwIfAborted();
  await input.metadata.requireCurrent(binding.route, undefined, input.signal);
  input.signal.throwIfAborted();
  const credentials = await input.settings.credentialsFor(
    binding.route,
    binding.admission,
    input.admissions,
    input.signal,
  );
  try {
    const connector = builtinModelConnector(
      binding.route,
      credentials.credentials,
      credentials.auth,
      input.transport,
    );
    if (connector.protocol !== binding.policy.protocol)
      throw new Error('Configured model host protocol differs from its connector');
    const active = async <T>(
      signal: AbortSignal,
      work: (signal: AbortSignal) => T | Promise<T>,
    ) => {
      const combined = AbortSignal.any([signal, credentials.signal]);
      combined.throwIfAborted();
      await input.admissions.requireActive(binding.admission, combined);
      combined.throwIfAborted();
      const value = await work(combined);
      await input.admissions.requireActive(binding.admission, combined);
      combined.throwIfAborted();
      return value;
    };
    const owner = input.ownerInput;
    const tools = input.toolAdmission;
    const original: RuntimeModelHost = {
      ...binding,
      signal: credentials.signal,
      input: owner && {
        revision: owner.revision,
        prepare: (value, signal) => active(signal, (signal) => owner.prepare(value, signal)),
        ...(owner.steer
          ? {
              steer: (value, request, terminal, signal) =>
                active(signal, (signal) => owner.steer!(value, request, terminal, signal)),
            }
          : {}),
      },
      toolAdmission: tools && {
        revision: tools.revision,
        chatToolsRequired: tools.chatToolsRequired,
        rejectionMessage: tools.rejectionMessage,
        requireAllowed: (name, args, signal = credentials.signal) =>
          active(signal, (signal) => tools.requireAllowed(name, args, signal)),
        projectResult: (value, signal = credentials.signal) =>
          active(signal, (signal) => tools.projectResult(value, signal)),
        ...(tools.selectChatTools
          ? {
              selectChatTools: (catalogue, signal = credentials.signal) =>
                active(signal, (signal) => tools.selectChatTools!(catalogue, signal)),
            }
          : {}),
      },
      reserve: (id, request, signal) =>
        active(signal, async (signal) => {
          await input.metadata.requireCurrent(binding.route, request, signal);
          signal.throwIfAborted();
          return input.requests.reserve(id, request, signal);
        }),
      complete: (id, request, signal, onText) =>
        active(signal, async (signal) => {
          await input.requests.requireDispatch(id, request, signal);
          await input.metadata.requireCurrent(binding.route, request, signal);
          signal.throwIfAborted();
          return connector.complete(request, signal, onText);
        }),
      ...(connector.continue
        ? {
            continue: (request, response, results, signal) =>
              active(signal, async (signal) => {
                await input.metadata.requireCurrent(
                  binding.route,
                  { kind: 'native', value: request },
                  signal,
                );
                signal.throwIfAborted();
                return connector.continue!(request, response, results, signal);
              }),
          }
        : {}),
    };
    const configured = bindConfiguredModelHost(input.store, original, credentials.auth.reference);
    return {
      model: configured.model,
      signal: configured.signal,
      close() {
        configured.close();
        credentials.close();
      },
    };
  } catch (error) {
    credentials.close();
    throw error;
  }
}
