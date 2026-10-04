import type { AgentModel, InteractionAnswer, PermissionMode } from '@skaro/timeline';
import { t } from '@skaro/ui';
import { onDestroy } from 'svelte';
import type { AgentInfo, AgentSettings, MergeAction, MessageInput } from '../../../shared/ipc';
import { provideFeed } from '../feed/context.svelte';
import { modelEffort, modelName } from '../feed/format';
import { TaskSession } from './session.svelte';

export function createTaskController(
  projectId: string,
  taskId: string,
  getAgents: () => AgentInfo[],
  /** Opens another task or a stage: «Открыть этап» in the result line of a stage task. */
  open?: (id: string) => void,
) {
  // The screen is keyed by task.
  // svelte-ignore state_referenced_locally
  const session = new TaskSession(projectId, taskId);
  void session.reload();
  onDestroy(() => session.dispose());

  let modal = $state(false);
  let viewer = $state<string | undefined>();
  let actionError = $state<string | undefined>();

  const view = $derived(session.view);
  const timeline = $derived(session.timeline);
  const settings = $derived(view?.settings);
  const started = $derived((timeline?.items.length ?? 0) > 0 || view?.queued === true);
  const running = $derived(timeline !== undefined && timeline.status !== 'idle');
  const agentInfo = $derived(
    getAgents().find((a) => a.id === (view?.run?.agent ?? settings?.agent)),
  );
  const cwd = $derived(view?.run?.worktree);
  const openQuestion = $derived(timeline?.interactions.find((i) => i.kind === 'question'));
  const openApproval = $derived(timeline?.interactions.find((i) => i.kind === 'approval'));

  // The model's own name ("Opus 5.5") from the agent's list, not the agent's name.
  let models = $state.raw<AgentModel[]>([]);
  $effect(() => {
    const agent = agentInfo?.id;
    if (!agent || !agentInfo.installed) return;
    void window.skaro
      .invoke('agents.models', agent, projectId)
      .then((list) => (models = list))
      .catch(() => (models = []));
  });
  const modelLabel = $derived(modelName(timeline?.session?.model || settings?.model, models));
  const effort = $derived(
    modelEffort(timeline?.session?.model || settings?.model, settings?.effort, models),
  );

  // The screen of a stage: before every task is done its field is closed.
  const stageLeft = $derived(view?.stage ? view.stage.info.total - view.stage.info.finished : 0);
  const placeholder = $derived(
    openQuestion || openApproval
      ? t('composer.answer')
      : view?.stage && stageLeft > 0
        ? t('composer.stage.closed')
        : !started
          ? t(view?.stage ? 'composer.stage.start' : 'composer.start')
          : t('composer.placeholder'),
  );

  const mergeMessage = $derived(view ? `${view.task.id}: ${view.task.title}` : '');

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
    // Text typed while a question or a permission is open answers it in the user's own words.
    if (openQuestion?.kind === 'question') {
      const answer: InteractionAnswer = {
        kind: 'question',
        answers: Object.fromEntries(openQuestion.questions.map((q) => [q.id, [input.text]])),
      };
      return respond(openQuestion.id, answer);
    }
    if (openApproval?.kind === 'approval') {
      return respond(openApproval.id, { kind: 'approval', choice: 'deny', message: input.text });
    }
    await guard(() => window.skaro.invoke('task.send', projectId, taskId, input));
  }

  function respond(id: string, answer: InteractionAnswer): Promise<void> {
    return guard(() => window.skaro.invoke('task.respond', projectId, taskId, id, answer));
  }

  async function saveSettings(next: AgentSettings): Promise<void> {
    await guard(() => window.skaro.invoke('task.setSettings', projectId, taskId, next));
  }

  function setPermission(mode: PermissionMode): void {
    if (settings) void saveSettings({ ...settings, permissionMode: mode }).catch(() => undefined);
  }

  provideFeed({
    get cwd() {
      return cwd;
    },
    get interactive() {
      return true;
    },
    openPath: (path) =>
      void guard(() => window.skaro.invoke('files.open', projectId, taskId, path)).catch(
        () => undefined,
      ),
    existing: (paths) =>
      window.skaro.invoke('files.exist', projectId, taskId, paths).catch(() => []),
    fileDiff: (path) => window.skaro.invoke('files.diff', projectId, taskId, path),
    openExternal: (url) => void window.skaro.invoke('shell.openExternal', url),
    viewImage: (src) => (viewer = src),
    stopBackground: (id) =>
      void guard(() => window.skaro.invoke('task.stopBackground', projectId, taskId, id)).catch(
        () => undefined,
      ),
    respond,
    merge: (id: string, action: MergeAction) =>
      window.skaro.invoke('task.merge', projectId, taskId, id, action),
    revertMerge: (commit) =>
      guard(() => window.skaro.invoke('task.revertMerge', projectId, taskId, commit)),
    restart: () => void send({ text: t('task.start.message') }).catch(() => undefined),
    ...(open ? { openStage: open } : {}),
  });

  return {
    session,
    send,
    saveSettings,
    setPermission,
    get view() {
      return view;
    },
    get timeline() {
      return timeline;
    },
    get settings() {
      return settings;
    },
    get running() {
      return running;
    },
    get agentInfo() {
      return agentInfo;
    },
    get cwd() {
      return cwd;
    },
    get placeholder() {
      return placeholder;
    },
    get modelLabel() {
      return modelLabel;
    },
    /** The effort and the model's levels, for the composer's model button. */
    get effort() {
      return effort;
    },
    get mergeMessage() {
      return mergeMessage;
    },
    get modal() {
      return modal;
    },
    set modal(value: typeof modal) {
      modal = value;
    },
    get viewer() {
      return viewer;
    },
    set viewer(value: typeof viewer) {
      viewer = value;
    },
    get actionError() {
      return actionError;
    },
    set actionError(value: typeof actionError) {
      actionError = value;
    },
  };
}
export type TaskController = ReturnType<typeof createTaskController>;
