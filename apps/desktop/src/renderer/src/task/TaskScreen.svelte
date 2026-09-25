<script lang="ts">
  import type { InteractionAnswer, PermissionMode } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { AgentInfo, AgentSettings, MergeAction, MessageInput } from '../../../shared/ipc';
  import { provideFeed } from '../feed/context.svelte';
  import Feed from '../feed/Feed.svelte';
  import ImageViewer from '../feed/ImageViewer.svelte';
  import PinnedZone from '../feed/PinnedZone.svelte';
  import '../feed/i18n';
  import AgentModal from './AgentModal.svelte';
  import Composer from './Composer.svelte';
  import SessionBanners from './SessionBanners.svelte';
  import { TaskSession } from './session.svelte';
  import TaskDescription from './TaskDescription.svelte';

  /** "Задача": description on the left, the agent feed and the composer (mockup Task). */
  let {
    projectId,
    taskId,
    agents,
    ontasks,
  }: { projectId: string; taskId: string; agents: AgentInfo[]; ontasks: () => void } = $props();

  // The screen is keyed by task.
  // svelte-ignore state_referenced_locally
  const session = new TaskSession(projectId, taskId);
  void session.reload();
  onDestroy(() => session.dispose());

  let descOpen = $state(true);
  let descWidth = $state(318);
  let modal = $state(false);
  let viewer = $state<string | undefined>();
  let actionError = $state<string | undefined>();

  void window.skaro.invoke('app.getSetting', 'ui.taskDesc').then((saved) => {
    const s = saved as { open?: boolean; width?: number } | null;
    if (s?.open === false) descOpen = false;
    if (typeof s?.width === 'number') descWidth = Math.max(240, Math.min(520, s.width));
  });

  function saveDesc(): void {
    void window.skaro.invoke('app.setSetting', 'ui.taskDesc', { open: descOpen, width: descWidth });
  }

  const view = $derived(session.view);
  const timeline = $derived(session.timeline);
  const settings = $derived(view?.settings);
  const started = $derived((timeline?.items.length ?? 0) > 0 || view?.queued === true);
  const running = $derived(timeline !== undefined && timeline.status !== 'idle');
  const agentInfo = $derived(agents.find((a) => a.id === (view?.run?.agent ?? settings?.agent)));
  const cwd = $derived(view?.run?.worktree);
  const done = $derived(view?.task.status === 'done');
  const openQuestion = $derived(timeline?.interactions.find((i) => i.kind === 'question'));
  const openApproval = $derived(timeline?.interactions.find((i) => i.kind === 'approval'));

  const modelLabel = $derived.by(() => {
    const id = timeline?.session?.model || settings?.model;
    if (!id) return agentInfo?.id === 'codex' ? 'Codex' : 'Claude Code';
    return prettyModel(id);
  });

  function prettyModel(id: string): string {
    const claude = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(id);
    if (claude) {
      const name = claude[1]![0]!.toUpperCase() + claude[1]!.slice(1);
      return `${name} ${claude[2]}${claude[3] && claude[3].length <= 2 ? `.${claude[3]}` : ''}`;
    }
    if (id === 'default') return 'Claude Code';
    return id;
  }

  const placeholder = $derived(
    openQuestion || openApproval
      ? t('composer.answer')
      : !started
        ? t('composer.start')
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
      return !done;
    },
    openPath: (path) =>
      void guard(() => window.skaro.invoke('files.open', projectId, taskId, path)).catch(
        () => undefined,
      ),
    existing: (paths) =>
      window.skaro.invoke('files.exist', projectId, taskId, paths).catch(() => []),
    openExternal: (url) => void window.skaro.invoke('shell.openExternal', url),
    viewImage: (src) => (viewer = src),
    stopBackground: (id) =>
      void guard(() => window.skaro.invoke('task.stopBackground', projectId, taskId, id)).catch(
        () => undefined,
      ),
    respond,
    merge: (id: string, action: MergeAction) =>
      window.skaro.invoke('task.merge', projectId, taskId, id, action),
    rewind: (itemId, resend) =>
      guard(() => window.skaro.invoke('task.rewind', projectId, taskId, itemId, resend)),
    restart: () => void send({ text: t('task.start.message') }).catch(() => undefined),
  });

  let dragging = false;
  function startResize(event: PointerEvent): void {
    dragging = true;
    const startX = event.clientX;
    const startWidth = descWidth;
    const move = (e: PointerEvent) => {
      if (dragging) descWidth = Math.max(240, Math.min(520, startWidth + e.clientX - startX));
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveDesc();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<div class="task">
  {#if view}
    {#if descOpen}
      <div class="desc-col" style="width: {descWidth}px">
        <TaskDescription
          task={view.task}
          oncollapse={() => {
            descOpen = false;
            saveDesc();
          }}
          {ontasks}
          ontoggle={(i) => void window.skaro.invoke('task.toggleCriterion', projectId, taskId, i)}
        />
      </div>
      <div class="resizer">
        <div
          class="grip"
          role="separator"
          aria-orientation="vertical"
          data-tip={t('task.resize')}
          onpointerdown={startResize}
        ></div>
      </div>
    {/if}
    <div class="main">
      {#if !descOpen}
        <div class="head">
          <button
            type="button"
            class="expand"
            data-tip={t('task.expand')}
            aria-label={t('task.expand')}
            onclick={() => {
              descOpen = true;
              saveDesc();
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path><path
                d="m5.6 10.6 1.4 1.4-1.4 1.4"
              ></path></svg
            >
          </button>
          <div class="crumbs">
            <button
              type="button"
              class="crumb"
              data-tip={t('task.crumbs.tasks.tip')}
              onclick={ontasks}>{t('task.crumbs.tasks')}</button
            >
            <span class="slash">/</span>
            <span class="id">{view.task.id}</span>
            <span class="slash">·</span>
            <span class="name">{view.task.title}</span>
          </div>
        </div>
      {/if}

      <div class="banners">
        <SessionBanners
          agent={agentInfo}
          limits={timeline?.limits}
          error={actionError ?? session.error}
          ondismiss={() => (actionError = undefined)}
        />
      </div>

      {#if timeline && timeline.items.length}
        <Feed {timeline} {cwd} {mergeMessage} />
      {:else if view.queued}
        <div class="empty">
          <Icon name="clock" size={30} stroke={1.5} color="#3b3b3b" />
          <span class="empty-text">{t('task.queued')}</span>
        </div>
      {:else if running}
        <div class="empty"><span class="fd-pulse"></span></div>
      {:else}
        <div class="empty">
          <Icon name="message" size={30} stroke={1.5} color="#3b3b3b" />
          <span class="empty-title">{t('task.empty.title')}</span>
          <span class="empty-text">{t('task.empty.text')}</span>
          <button
            type="button"
            class="start"
            data-tip={view.slotsFree ? t('task.start.tip') : t('task.start.queue.tip')}
            onclick={() => void send({ text: t('task.start.message') }).catch(() => undefined)}
          >
            <Icon name="play" size={13} stroke={2} />
            {view.slotsFree ? t('task.start') : t('task.start.queue')}
          </button>
        </div>
      {/if}

      {#if !done}
        <div class="bottom">
          {#if timeline}<PinnedZone {timeline} />{/if}
          {#if settings}
            <Composer
              {placeholder}
              {running}
              agent={agentInfo?.id ?? settings.agent}
              model={modelLabel}
              {...timeline?.usage?.contextUsedPct !== undefined
                ? { contextPct: timeline.usage.contextUsedPct }
                : {}}
              permissionMode={settings.permissionMode}
              planFirst={settings.planFirst}
              commands={() => window.skaro.invoke('agents.commands', settings.agent, projectId)}
              suggest={(q) => window.skaro.invoke('files.suggest', projectId, taskId, q)}
              onsend={send}
              onstop={() => void window.skaro.invoke('task.interrupt', projectId, taskId)}
              onmodel={() => (modal = true)}
              onpermission={setPermission}
            />
          {/if}
        </div>
      {/if}
    </div>
  {:else if session.error}
    <div class="main">
      <div class="empty"><span class="empty-text">{t('task.notFound')}</span></div>
    </div>
  {/if}
</div>

{#if view && settings}
  <AgentModal
    bind:open={modal}
    {projectId}
    {settings}
    {agents}
    locked={view.run !== undefined}
    {...view.task.branch ? { branch: view.task.branch } : {}}
    {...view.sandboxHolds !== undefined ? { sandboxHolds: view.sandboxHolds } : {}}
    onsave={saveSettings}
  />
{/if}
<ImageViewer bind:src={viewer} />

<style>
  .task {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }

  .desc-col {
    flex: none;
    min-height: 0;
    overflow-y: auto;
  }

  .resizer {
    flex: none;
    position: relative;
    width: 1px;
    background: #1a1a1a;
    z-index: 5;
  }

  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    width: 9px;
    cursor: col-resize;
  }

  .grip:hover {
    background: linear-gradient(90deg, transparent 3px, #2a52be 3px, #2a52be 6px, transparent 6px);
  }

  .main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #121212;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 14px 0;
  }

  .expand {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: #1c1c1c;
    color: #b1b1b1;
    cursor: pointer;
    padding: 0;
  }

  .expand:hover {
    color: #ededed;
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: #7d7d7d;
    min-width: 0;
  }

  .crumb {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .crumb:hover {
    color: #d5d5d5;
  }

  .slash {
    color: #4a4a4a;
  }

  .id {
    font-family: var(--sk-mono);
    color: #a6a6a6;
  }

  .name {
    color: #a6a6a6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banners {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px 0;
  }

  .banners:empty {
    display: none;
  }

  .empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px;
  }

  .empty-title {
    font-size: 14px;
    font-weight: 600;
    color: #a6a6a6;
  }

  .empty-text {
    max-width: 320px;
    font-size: 12.5px;
    line-height: 1.5;
    color: #7d7d7d;
    text-align: center;
    text-wrap: pretty;
  }

  .start {
    margin-top: 2px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 15px;
    border: none;
    border-radius: 8px;
    background: #2a52be;
    color: #fff;
    font: inherit;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
  }

  .start:hover {
    background: #3461d6;
  }

  .bottom {
    flex: none;
    padding: 0 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
