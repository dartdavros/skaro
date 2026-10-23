import { OwnerMessages } from '../feed/owner-messages.svelte';
import { cleanError } from '../feed/action-error';
import type { AgentModel, InteractionAnswer, PermissionMode } from '@skaro/timeline';
import { t } from '@skaro/ui';
import { onDestroy } from 'svelte';
import type { AgentInfo, AgentSettings, MergeAction, MessageInput } from '../../../shared/ipc';
import { provideFeed } from '../feed/context.svelte';
import { historyActions } from '../feed/history-actions';
import { modelEffort, modelName } from '../feed/format';
import { TaskSession } from './session.svelte';
import { TaskStartState } from './task-start-state';

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

  const ownerMessages = new OwnerMessages();
  void window.skaro.invoke('commands.list', projectId, taskId).then((commands) => {
    ownerMessages.restore(commands);
    actionError = commands.find((command) => command.error)?.error;
  });
  const stopCommands = window.skaro.on('command.changed', (command) => {
    if (command.owner !== `${projectId}:${taskId}`) return;
    if (command.state === 'accepted' || command.state === 'delivering')
      ownerMessages.restore([command]);
    if (command.state === 'cancelled') ownerMessages.cancel(command.id);
    if (command.error) {
      ownerMessages.failed(command.id, command.error);
      actionError = command.error;
    }
  });
  onDestroy(stopCommands);
  $effect(() => ownerMessages.reconcile(session.timeline));
  let modal = $state(false);
  let viewer = $state<string | undefined>();
  let actionError = $state<string | undefined>();
  const startState = $state({ pending: false });
  // svelte-ignore state_referenced_locally
  const startRequest = new TaskStartState(startState);

  const view = $derived(session.view);
  const timeline = $derived(ownerMessages.timeline(session.timeline));
  const hasFeed = $derived(
    !!timeline &&
      (timeline.items.length > 0 ||
        !!view?.history?.count ||
        timeline.interactions.some((interaction) => interaction.kind === 'merge') ||
        (!!view?.stage && timeline.interactions.length > 0)),
  );
  const settings = $derived(view?.settings);
  const started = $derived((timeline?.items.length ?? 0) > 0 || view?.queued === true);
  const running = $derived(timeline !== undefined && timeline.status !== 'idle');
  $effect(() => {
    startRequest.update({
      hasFeed,
      queued: view?.queued === true,
      error: !!(actionError || session.error),
    });
  });
  // A live integration works in this feed with its own agent: the model shown is that agent's.
  const live = $derived(view?.timelineSources?.integrations.findLast((s) => s.live && s.agent));
  const agentInfo = $derived(
    getAgents().find((a) => a.id === (live?.agent ?? view?.run?.agent ?? settings?.agent)),
  );
  const cwd = $derived(view?.executionWorktree ?? view?.run?.worktree);
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
    modelEffort(
      timeline?.session?.model || settings?.model,
      live ? live.effort : settings?.effort,
      models,
    ),
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

  async function send(input: MessageInput): Promise<void> {
    // Text typed while a question or a permission is open answers it in the user's own words.
    if (openQuestion?.kind === 'question') {
      if (openQuestion.questions.length !== 1) {
        actionError = t('card.question.notReady');
        throw new Error(actionError);
      }
      const answer: InteractionAnswer = {
        kind: 'question',
        answers: Object.fromEntries(openQuestion.questions.map((q) => [q.id, [input.text]])),
      };
      return respond(openQuestion.id, answer);
    }
    if (openApproval?.kind === 'approval') {
      return respond(openApproval.id, { kind: 'approval', choice: 'deny', message: input.text });
    }
    await guard(() =>
      ownerMessages.send(input, (value) =>
        window.skaro.invoke('task.send', projectId, taskId, value),
      ),
    );
  }

  async function start(): Promise<void> {
    if (!startRequest.begin()) return;
    try {
      await send({ text: t('task.start.message') });
    } catch (error) {
      startRequest.cancel();
      throw error;
    }
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
    ...historyActions(
      projectId,
      (error) => {
        actionError = error;
      },
      (page) => session.rememberPage(page),
      () => void session.reload(),
    ),
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
    openExternal: (url) =>
      void guard(() => window.skaro.invoke('task.openExternal', projectId, taskId, url)).catch(
        () => undefined,
      ),
    viewImage: (src) => (viewer = src),
    stopBackground: (id) =>
      void guard(() => window.skaro.invoke('task.stopBackground', projectId, taskId, id)).catch(
        () => undefined,
      ),
    respond,
    proposal: (itemId, action) =>
      guard(() => {
        if (action.action === 'revert')
          throw new Error('C4 packages require a new reverse proposal.');
        return window.skaro.invoke(
          'c4.decide',
          projectId,
          itemId,
          action.action,
          action.action === 'apply' ? action.fingerprint : undefined,
        );
      }),
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
    start,
    saveSettings,
    setPermission,
    stopEnvironmentReview: () =>
      void guard(() => window.skaro.invoke('task.stopEnvironmentReview', projectId, taskId)).catch(
        () => undefined,
      ),
    get view() {
      return view;
    },
    get timeline() {
      return timeline;
    },
    get hasFeed() {
      return hasFeed;
    },
    get settings() {
      return settings;
    },
    get running() {
      return running;
    },
    get starting() {
      return startState.pending;
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
