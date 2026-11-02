import { prepareSkaroOperations, readRuntimeJournal } from '@skaro/agent-runtime';
import type { McpHttpServer, SkaroScope } from '@skaro/mcp-server';
import type {
  BuiltinSessionStart,
  ChatRequest,
  ModelTool,
  ModelToolAdmission,
  RuntimeVerificationHost,
  SessionOptions,
} from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import type { BuiltinModelSettingsService } from './builtin-model-settings-service';
import type { BuiltinModelCatalog } from './builtin-model-catalog';
import type { NativeAdmissions } from './native/admissions';
import { prepareConfiguredModelHost } from './builtin-configured-host';
import { createContextChatInput } from './builtin-context-chat-input';
import { createContextNativeInput } from './builtin-context-native-input';
import { modelNetworkTransport } from './model-network-transport';
import { configuredTaskTools } from './builtin-model-tools';

export interface BuiltinSessionPreparation {
  scope: SkaroScope;
  sessionId: string;
  journalPath: string;
  artifactDir: string;
  options: SessionOptions;
  admissions: NativeAdmissions;
  verification?: RuntimeVerificationHost;
  signal: AbortSignal;
}

export interface BuiltinSessionModelGrant {
  config: Omit<BuiltinSessionStart, 'model' | 'extensions' | 'extensionsScope'>;
  price: ChatRequest['price'];
  maxSteps: number;
  tools: ModelToolAdmission;
  modelTools: readonly ModelTool[];
  operations: readonly { name: string; readOnly: boolean }[];
  requests: Parameters<typeof prepareConfiguredModelHost>[0]['requests'];
}

export interface BuiltinSessionModelDependencies {
  store: BuiltinModelConfigurationStore;
  settings: BuiltinModelSettingsService;
  catalog: BuiltinModelCatalog;
  mcp: McpHttpServer<SkaroScope>;
  proxy?: string;
}

/** Shared task/chat model composition. Authorization and exact owner policy remain with the caller. */
export async function prepareBuiltinSessionModel(
  deps: BuiltinSessionModelDependencies,
  input: BuiltinSessionPreparation,
  grant: BuiltinSessionModelGrant,
  validate: (config: BuiltinSessionStart) => void,
) {
  input.signal.throwIfAborted();
  const selected = structuredClone(grant.config);
  const chat = ['openrouter', 'deepseek'].includes(selected.route.connector);
  const extensions = prepareSkaroOperations(
    deps.mcp.operations(input.scope, input.admissions),
    input.admissions.admission,
    deps.mcp.describe(input.scope),
    grant.operations,
    input.signal,
  );
  const formatting = {
    journalPath: input.journalPath,
    sessionId: input.sessionId,
    route: selected.route,
    maxSteps: grant.maxSteps,
    tools: configuredTaskTools(grant.modelTools, extensions),
  };
  const ownerInput = chat
    ? createContextChatInput({ ...formatting, price: grant.price })
    : createContextNativeInput(formatting);
  const config: BuiltinSessionStart = {
    ...selected,
    tools: selected.tools && {
      ...selected.tools,
      ...(input.verification ? { verificationScope: structuredClone(input.scope) } : {}),
    },
    extensions: extensions.tools.map(({ name, revision, readOnly }) => ({
      name,
      revision,
      readOnly,
    })),
    extensionsScope: structuredClone(input.scope),
    model: {
      scope: structuredClone(input.scope),
      protocol: chat ? 'chat' : 'native',
      input: { revision: ownerInput.revision, steer: true },
      tools: {
        revision: grant.tools.revision,
        selectChatTools: !!grant.tools.selectChatTools,
        chatToolsRequired: grant.tools.chatToolsRequired,
        rejectionMessage: grant.tools.rejectionMessage,
      },
    },
  };
  validate(config);
  const baseline = await readRuntimeJournal(input.journalPath, input.sessionId, true);
  input.signal.throwIfAborted();
  const configured = await prepareConfiguredModelHost({
    store: deps.store,
    settings: deps.settings,
    metadata: deps.catalog,
    binding: {
      scope: input.scope,
      admission: input.admissions.admission,
      route: config.route,
      journalPath: input.journalPath,
      baseSequence: baseline.records.length,
      baseHash: baseline.records.at(-1)?.hash ?? '',
      policy: config.model!,
    },
    admissions: input.admissions,
    signal: input.signal,
    ownerInput,
    toolAdmission: grant.tools,
    requests: grant.requests,
    transport: await modelNetworkTransport(deps.proxy),
  });
  return {
    config,
    host: {
      signal: configured.signal,
      model: configured.model,
      verification: input.verification,
      extensions: {
        scope: input.scope,
        admission: input.admissions.admission,
        extensions,
        signal: input.signal,
      },
    },
    close: configured.close,
  };
}
