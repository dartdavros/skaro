<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { AgentInfo } from '../../../shared/ipc';
  import Feed from '../feed/Feed.svelte';
  import ImageViewer from '../feed/ImageViewer.svelte';
  import '../feed/i18n';
  import SessionBanners from '../task/SessionBanners.svelte';
  import ImportReview from '../import/ImportReview.svelte';
  import { changedPanel } from '../side-panels.svelte';
  import './i18n';
  import './chat-pane.css';
  import { createChatController } from './chat-controller.svelte';
  import ChatControls from './ChatControls.svelte';
  import ChatStart from './ChatStart.svelte';
  import ChatChangedPanel from './ChatChangedPanel.svelte';
  let {
    projectId,
    projectPath,
    agents,
    chatId,
    oncreated,
    onsection,
    onimport,
  }: {
    projectId: string;
    projectPath: string;
    agents: AgentInfo[];
    chatId: string | undefined;
    oncreated: (chatId: string) => void;
    onsection: (section: 'plan' | 'docs' | 'tasks') => void;
    /** "Импортировать документацию" (ImportModal). */
    onimport: () => void;
  } = $props();

  // The pane is keyed by chat.
  // svelte-ignore state_referenced_locally
  const controller = createChatController(
    projectId,
    projectPath,
    chatId,
    () => agents,
    (id) => oncreated(id),
    (section) => onsection(section),
  );
  let controls: ChatControls | undefined = $state();
</script>

<div class="main">
  <div class="head">
    <span class="title">{controller.title}</span>
    <button
      type="button"
      class="archive"
      class:on={changedPanel.open}
      data-tip={t('chat.changed.toggle')}
      aria-label={t('chat.changed.toggle')}
      aria-pressed={changedPanel.open}
      onclick={() => (changedPanel.open = !changedPanel.open)}
    >
      <Icon name="docText" size={15} stroke={1.8} />
    </button>
    {#if controller.view && !controller.archived}
      <button
        type="button"
        class="archive"
        data-tip={t('chat.archive')}
        aria-label={t('chat.archive')}
        onclick={() => controller.setArchived(true)}
      >
        <Icon name="archive" size={15} stroke={1.8} />
      </button>
    {/if}
  </div>

  <div class="banners">
    <SessionBanners
      agent={controller.agentInfo}
      limits={controller.timeline?.limits}
      error={controller.actionError ?? controller.sessionError}
      ondismiss={() => (controller.actionError = undefined)}
    />
  </div>

  {#if controller.timeline && controller.started}
    <Feed timeline={controller.timeline} cwd={projectPath} mergeMessage="" />
  {:else if controller.running || (controller.view && !controller.archived)}
    <!-- The first message is on its way: the agent is starting. -->
    <div class="empty"><span class="fd-pulse"></span></div>
  {:else if controller.sessionError && !controller.view}
    <div class="empty"><span class="empty-text">{t('chat.notFound')}</span></div>
  {:else if !chatId}
    <ChatStart
      hasCode={controller.hasCode}
      {onimport}
      onprefill={(text) => controls?.prefill(text)}
    />
  {:else}
    <div class="empty"></div>
  {/if}

  <ChatControls bind:this={controls} {controller} {projectId} {chatId} {agents} />
</div>

{#if changedPanel.open}
  <ChatChangedPanel items={controller.timeline?.items ?? []} />
{/if}

<ImageViewer bind:src={controller.viewer} />
{#if controller.reviewing && chatId}
  {@const itemId = controller.reviewing}
  <ImportReview
    {projectId}
    {chatId}
    onclose={() => (controller.reviewing = undefined)}
    onapply={(keys) =>
      window.skaro.invoke('chat.proposal', projectId, chatId, itemId, {
        action: 'apply',
        import: keys,
      })}
  />
{/if}
