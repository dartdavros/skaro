import { prepareSkaroOperations, readRuntimeJournal } from '@skaro/agent-runtime';
import type { McpHttpServer, SkaroScope } from '@skaro/mcp-server';
import type {
  BuiltinSessionStart,
  ChatRequest,
  ModelTool,
  ModelToolAdmission,
} from '@skaro/timeline';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import type { BuiltinModelSettingsService } from './builtin-model-settings-service';
import type { BuiltinModelCatalog } from './builtin-model-catalog';
import type { BuiltinTaskSessionPreparer } from './builtin-task-session';
import { prepareConfiguredModelHost } from './builtin-configured-host';
import { createContextChatInput } from './builtin-context-chat-input';
import { createContextNativeInput } from './builtin-context-native-input';
import { modelNetworkTransport } from './model-network-transport';
import { requireBuiltinTaskSessionPolicy } from './builtin-task-session-policy';
import { configuredTaskTools } from './builtin-model-tools';

type Preparation = Parameters<BuiltinTaskSessionPreparer['prepare']>[0];

export interface BuiltinTaskModelGrant {
  config: Omit<BuiltinSessionStart, 'model' | 'extensions' | 'extensionsScope'>;
  price: ChatRequest['price'];
  maxSteps: number;
  tools: ModelToolAdmission;
  modelTools: readonly ModelTool[];
  operations: readonly { name: string; readOnly: boolean }[];
  requests: Parameters<typeof prepareConfiguredModelHost>[0]['requests'];
}

/** Main-only owner authorization for the concrete task context, tools and bounded requests. */
export type BuiltinTaskAuthorization = (input: Preparation) => Promise<BuiltinTaskModelGrant>;

interface Dependencies {
  store: BuiltinModelConfigurationStore;
  settings: BuiltinModelSettingsService;
  catalog: BuiltinModelCatalog;
  mcp: McpHttpServer<SkaroScope>;
  authorize: BuiltinTaskAuthorization;
  proxy?: string;
}

/** Production composition: the common vault/catalog, actual scoped handlers and durable model host. */
export class BuiltinTaskModels implements BuiltinTaskSessionPreparer {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }

  async prepare(input: Preparation) {
    input.signal.throwIfAborted();
    const grant = await this.deps.authorize(input);
    input.signal.throwIfAborted();
    const selected = structuredClone(grant.config);
    const chat = ['openrouter', 'deepseek'].includes(selected.route.connector);
    const extensions = prepareSkaroOperations(
      this.deps.mcp.operations(input.scope, input.admissions),
      input.admissions.admission,
      this.deps.mcp.describe(input.scope),
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
        verificationScope: structuredClone(input.scope),
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
    requireBuiltinTaskSessionPolicy(input, config);
    const baseline = await readRuntimeJournal(input.journalPath, input.sessionId, true);
    input.signal.throwIfAborted();
    const configured = await prepareConfiguredModelHost({
      store: this.deps.store,
      settings: this.deps.settings,
      metadata: this.deps.catalog,
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
      transport: await modelNetworkTransport(this.deps.proxy),
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
}
