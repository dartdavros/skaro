<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import Feed from '../feed/Feed.svelte';
  import PinnedZone from '../feed/PinnedZone.svelte';
  import Composer from './Composer.svelte';
  import SessionBanners from './SessionBanners.svelte';
  import TaskCollapsedHeader from './TaskCollapsedHeader.svelte';
  import type { TaskController } from './task-controller.svelte';
  import './task-conversation.css';
  let {
    controller,
    projectId,
    taskId,
    descriptionOpen,
    onexpand,
    ontasks,
  }: {
    controller: TaskController;
    projectId: string;
    taskId: string;
    descriptionOpen: boolean;
    onexpand: () => void;
    ontasks: () => void;
  } = $props();
  const view = $derived(controller.view);
  const timeline = $derived(controller.timeline);
  const settings = $derived(controller.settings);
  const agentInfo = $derived(controller.agentInfo);
  const cwd = $derived(controller.cwd);
  const mergeMessage = $derived(controller.mergeMessage);
</script>

<div class="main task-conversation">
  {#if view}
    {#if !descriptionOpen}<TaskCollapsedHeader task={view.task} {onexpand} {ontasks} />{/if}
    <div class="banners">
      <SessionBanners
        agent={agentInfo}
        limits={timeline?.limits}
        error={controller.actionError ?? controller.session.error}
        ondismiss={() => (controller.actionError = undefined)}
      />
    </div>

    {#if timeline && timeline.items.length}
      <Feed {timeline} {cwd} {mergeMessage} />
    {:else if view.queued}
      <div class="empty">
        <Icon name="clock" size={30} stroke={1.5} color="var(--sk-text-29)" />
        <span class="empty-text">{t('task.queued')}</span>
      </div>
    {:else if controller.running}
      <div class="empty"><span class="fd-pulse"></span></div>
    {:else}
      <div class="empty">
        <Icon name="message" size={30} stroke={1.5} color="var(--sk-text-29)" />
        <span class="empty-title">{t('task.empty.title')}</span>
        <span class="empty-text">{t('task.empty.text')}</span>
        <button
          type="button"
          class="start"
          data-tip={view.slotsFree ? t('task.start.tip') : t('task.start.queue.tip')}
          onclick={() =>
            void controller.send({ text: t('task.start.message') }).catch(() => undefined)}
        >
          <Icon name="play" size={13} stroke={2} />
          {view.slotsFree ? t('task.start') : t('task.start.queue')}
        </button>
      </div>
    {/if}

    <!-- The chat stays after the task is done: follow-up questions go on in it. -->
    {#if view}
      <div class="bottom">
        {#if timeline}<PinnedZone {timeline} />{/if}
        {#if settings}
          <Composer
            placeholder={controller.placeholder}
            running={controller.running}
            agent={agentInfo?.id ?? settings.agent}
            model={controller.modelLabel}
            {...timeline?.usage?.contextUsedPct !== undefined
              ? { contextPct: timeline.usage.contextUsedPct }
              : {}}
            permissionMode={settings.permissionMode}
            planFirst={settings.planFirst}
            commands={() => window.skaro.invoke('agents.commands', settings.agent, projectId)}
            suggest={(q) => window.skaro.invoke('files.suggest', projectId, taskId, q)}
            onsend={controller.send}
            onstop={() => void window.skaro.invoke('task.interrupt', projectId, taskId)}
            onmodel={() => (controller.modal = true)}
            onpermission={controller.setPermission}
          />
        {/if}
      </div>
    {/if}
  {:else if controller.session.error}
    <div class="empty"><span class="empty-text">{t('task.notFound')}</span></div>
  {/if}
</div>
