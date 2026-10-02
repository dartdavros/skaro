import type { AgentModel, InteractionAnswer, PermissionMode } from '@skaro/timeline';
import { t } from '@skaro/ui';
import { onDestroy } from 'svelte';
import type {
  AgentInfo,
  AgentSettings,
  ChatSettings,
  MessageInput,
  ProposalAction,
} from '../../../shared/ipc';
import { provideFeed } from '../feed/context.svelte';
import { modelEffort, modelName } from '../feed/format';
import { ChatSession } from './session.svelte';
export function createChatController(
  projectId: string,
  projectPath: string,
  chatId: string | undefined,
  getAgents: () => AgentInfo[],
  oncreated: (chatId: string) => void,
  onsection: (section: 'plan' | 'docs' | 'tasks') => void,
) {
  // The pane is keyed by chat.
  const session = chatId ? new ChatSession(projectId, chatId) : undefined;
  void session?.reload();
  onDestroy(() => session?.dispose());

  // Plain (not a proxy): it goes to the main process as is.
  let draft = $state.raw<ChatSettings | undefined>();
  if (!chatId) {
    void window.skaro
      .invoke('chats.defaults', projectId)
      .then((s) => (draft = s))
      .catch(() => (draft = { agent: 'claude-code' }));
  }

  let modal = $state(false);
  /** Proposal item of the import whose review screen is open (ImportReview mockup). */
  let reviewing = $state<string | undefined>();
  /** The project has code of its own: the start screen offers a feature or a fix (D-32). */
  let hasCode = $state(false);
  void window.skaro
    .invoke('project.hasCode', projectId)
    .then((v) => (hasCode = v))
    .catch(() => undefined);
  let viewer = $state<string | undefined>();
  let actionError = $state<string | undefined>();

  const view = $derived(session?.view);
  const timeline = $derived(session?.timeline);
  const settings = $derived(view?.settings ?? draft);
  const archived = $derived(view?.chat.archived === true);
  const running = $derived(timeline !== undefined && timeline.status !== 'idle');
  const started = $derived((timeline?.items.length ?? 0) > 0);
  const agentInfo = $derived(getAgents().find((a) => a.id === settings?.agent));
  const title = $derived(view?.chat.title ?? t('chat.new'));
  const openQuestion = $derived(timeline?.interactions.find((i) => i.kind === 'question'));
  const openApproval = $derived(timeline?.interactions.find((i) => i.kind === 'approval'));
  // Model names come from the agent's own list ("Opus 5.5").
  let models = $state.raw<AgentModel[]>([]);
  $effect(() => {
    const agent = settings?.agent;
    if (!agent || !agentInfo?.installed) return;
    void window.skaro
      .invoke('agents.models', agent, projectId)
      .then((list) => (models = list))
      .catch(() => (models = []));
  });
  const modelLabel = $derived(modelName(timeline?.session?.model || settings?.model, models));
  const effort = $derived(
    modelEffort(timeline?.session?.model || settings?.model, settings?.effort, models),
  );
  /** The modal's settings; the same object until they change, so an open modal keeps its draft. */
  const modalSettings = $derived<AgentSettings | undefined>(
    settings && {
      agent: settings.agent,
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
      permissionMode: settings.permissionMode ?? 'ask',
      planFirst: false,
      isolation: 'in-place',
    },
  );

  async function guard(action: () => Promise<unknown>): Promise<void> {
    actionError = undefined;
    try {
      await action();
    } catch (error) {
      actionError = cleanError(error);
      throw error;
    }
  }

  function cleanError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  async function send(input: MessageInput): Promise<void> {
    if (!chatId) {
      if (!draft) return;
      const settings = draft;
      await guard(async () => {
        const chat = await window.skaro.invoke('chat.create', projectId, settings, input);
        oncreated(chat.id);
      });
      return;
    }
    // Text typed while a question or a permission is open answers it in the user's own words.
    if (openQuestion?.kind === 'question') {
      return respond(openQuestion.id, {
        kind: 'question',
        answers: Object.fromEntries(openQuestion.questions.map((q) => [q.id, [input.text]])),
      });
    }
    if (openApproval?.kind === 'approval') {
      return respond(openApproval.id, { kind: 'approval', choice: 'deny', message: input.text });
    }
    const id = chatId;
    await guard(() => window.skaro.invoke('chat.send', projectId, id, input));
  }

  function respond(id: string, answer: InteractionAnswer): Promise<void> {
    const chat = chatId;
    if (!chat) return Promise.resolve();
    return guard(() => window.skaro.invoke('chat.respond', projectId, chat, id, answer));
  }

  async function saveSettings(next: ChatSettings): Promise<void> {
    const value: ChatSettings = {
      agent: next.agent,
      ...(next.model ? { model: next.model } : {}),
      ...(next.effort ? { effort: next.effort } : {}),
      ...(next.permissionMode === 'full' ? { permissionMode: 'full' as const } : {}),
    };
    if (!chatId) {
      draft = value;
      // A new chat starts with what was chosen last (main: ChatSessions.defaults), always asking.
      const { permissionMode: _mode, ...last } = value;
      void window.skaro.invoke('app.setSetting', `chats.${projectId}.last`, last);
      return;
    }
    const chat = chatId;
    await guard(() => window.skaro.invoke('chat.setSettings', projectId, chat, value));
  }

  function setPermission(mode: PermissionMode): void {
    if (settings && mode !== 'auto')
      void saveSettings({ ...settings, permissionMode: mode }).catch(() => undefined);
  }

  function saveAgentSettings(next: AgentSettings): Promise<void> {
    return saveSettings({
      agent: next.agent,
      ...(next.model ? { model: next.model } : {}),
      ...(next.effort ? { effort: next.effort } : {}),
      ...(settings?.permissionMode === 'full' ? { permissionMode: 'full' as const } : {}),
    });
  }

  function setArchived(value: boolean): void {
    const chat = chatId;
    if (chat)
      void guard(() => window.skaro.invoke('chat.archive', projectId, chat, value)).catch(
        () => undefined,
      );
  }

  provideFeed({
    get cwd() {
      return projectPath;
    },
    get interactive() {
      return !archived;
    },
    openPath: (path) =>
      void guard(() => window.skaro.invoke('files.open', projectId, '', path)).catch(
        () => undefined,
      ),
    existing: (paths) => window.skaro.invoke('files.exist', projectId, '', paths).catch(() => []),
    fileDiff: (path) => window.skaro.invoke('files.diff', projectId, '', path),
    openExternal: (url) => void window.skaro.invoke('shell.openExternal', url),
    viewImage: (src) => (viewer = src),
    stopBackground: () => undefined,
    respond,
    merge: () => Promise.resolve(),
    restart: () => void send({ text: t('chat.continue') }).catch(() => undefined),
    proposal: (itemId: string, action: ProposalAction) => {
      const chat = chatId;
      if (!chat) return Promise.resolve();
      return guard(() => window.skaro.invoke('chat.proposal', projectId, chat, itemId, action));
    },
    openSection: (section) => onsection(section),
    reviewImport: (itemId) => (reviewing = itemId),
  });

  return {
    get view() {
      return view;
    },
    get timeline() {
      return timeline;
    },
    get settings() {
      return settings;
    },
    get archived() {
      return archived;
    },
    get running() {
      return running;
    },
    get started() {
      return started;
    },
    get agentInfo() {
      return agentInfo;
    },
    get title() {
      return title;
    },
    get modelLabel() {
      return modelLabel;
    },
    /** The effort and the model's levels, for the composer's model button. */
    get effort() {
      return effort;
    },
    get modalSettings() {
      return modalSettings;
    },
    get hasCode() {
      return hasCode;
    },
    get sessionError() {
      return session?.error;
    },
    get actionError() {
      return actionError;
    },
    set actionError(value: typeof actionError) {
      actionError = value;
    },
    get modal() {
      return modal;
    },
    set modal(value: boolean) {
      modal = value;
    },
    get viewer() {
      return viewer;
    },
    set viewer(value: typeof viewer) {
      viewer = value;
    },
    get reviewing() {
      return reviewing;
    },
    set reviewing(value: typeof reviewing) {
      reviewing = value;
    },
    send,
    saveAgentSettings,
    setPermission,
    setArchived,
  };
}
export type ChatController = ReturnType<typeof createChatController>;
