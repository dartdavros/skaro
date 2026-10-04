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
    onplan,
  }: {
    controller: TaskController;
    projectId: string;
    taskId: string;
    descriptionOpen: boolean;
    onexpand: () => void;
    ontasks: () => void;
    onplan: () => void;
  } = $props();
  const view = $derived(controller.view);
  const timeline = $derived(controller.timeline);
  const settings = $derived(controller.settings);
  const agentInfo = $derived(controller.agentInfo);
  const cwd = $derived(controller.cwd);
  const mergeMessage = $derived(controller.mergeMessage);
  // The screen of a stage: its acceptance. Until every task is done there is nothing to accept.
  const stage = $derived(view?.stage);
  const left = $derived(stage ? stage.info.total - stage.info.finished : 0);
  // A merge card of the stage («Влить готовое») shows before the acceptance wrote anything.
  const hasFeed = $derived(
    !!timeline && (timeline.items.length > 0 || (!!stage && timeline.interactions.length > 0)),
  );
</script>

<div class="main task-conversation">
  {#if view}
    {#if stage}
      <TaskCollapsedHeader
        task={view.task}
        plan
        expandable={!descriptionOpen}
        {onexpand}
        ontasks={onplan}
      />
    {:else if !descriptionOpen}
      <TaskCollapsedHeader task={view.task} {onexpand} {ontasks} />
    {/if}
    <div class="banners">
      <SessionBanners
        agent={agentInfo}
        limits={timeline?.limits}
        error={controller.actionError ?? controller.session.error}
        ondismiss={() => (controller.actionError = undefined)}
      />
    </div>

    {#if timeline && hasFeed}
      <Feed {timeline} {cwd} {mergeMessage} />
    {:else if stage && left > 0}
      <div class="empty">
        <Icon name="tasks" size={30} stroke={1.5} color="var(--sk-text-29)" />
        <span class="empty-text">{t('task.stage.waiting', { n: left })}</span>
      </div>
    {:else if view.queued}
      <div class="empty">
        <Icon name="clock" size={30} stroke={1.5} color="var(--sk-text-29)" />
        <span class="empty-text"
          >{#if stage}{t('task.stage.queued')}{:else if view.task.staged && view.after}{t(
              'task.queued.stage',
            )}
            <span class="mono">{view.after}</span>{:else}{t('task.queued')}{/if}</span
        >
      </div>
    {:else if controller.running}
      <div class="empty"><span class="fd-pulse"></span></div>
    {:else}
      <div class="empty">
        <Icon name="message" size={30} stroke={1.5} color="var(--sk-text-29)" />
        <span class="empty-title">{t(stage ? 'task.stage.empty.title' : 'task.empty.title')}</span>
        <span class="empty-text">{t(stage ? 'task.stage.empty.text' : 'task.empty.text')}</span>
        {#if view.after}
          <!-- Another task of the stage works in their checkout: this one waits its turn. -->
          <button
            type="button"
            class="start"
            data-tip={t('task.start.stage.tip', { task: view.after })}
            onclick={() =>
              void controller.send({ text: t('task.start.message') }).catch(() => undefined)}
          >
            <Icon name="clock" size={13} stroke={2} />
            {t('task.start.stage')}
          </button>
        {:else}
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
        {/if}
      </div>
    {/if}

    <!-- The chat stays after the task is done: follow-up questions go on in it. -->
    {#if view}
      <!-- Before the acceptance the field of a stage is dimmed and takes no text. -->
      <div class="bottom" class:locked={!!stage && left > 0} inert={!!stage && left > 0}>
        {#if timeline}<PinnedZone {timeline} />{/if}
        {#if settings}
          <Composer
            placeholder={controller.placeholder}
            running={controller.running}
            agent={agentInfo?.id ?? settings.agent}
            model={controller.modelLabel}
            effort={controller.effort.effort}
            efforts={controller.effort.efforts}
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
