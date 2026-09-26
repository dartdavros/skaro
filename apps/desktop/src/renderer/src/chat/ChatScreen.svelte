<script lang="ts">
  import { Icon, Segmented, t } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { AgentInfo, ProjectInfo } from '../../../shared/ipc';
  import ChatPane from './ChatPane.svelte';
  import './i18n';
  import { ChatList } from './session.svelte';

  /**
   * "Чат" (AgentChat mockup): chats of the project on the left — active and archived, the open
   * chat in the middle, what the chat changed on the right.
   */
  let {
    project,
    agents,
    chat = $bindable(),
    onsection,
  }: {
    project: ProjectInfo;
    agents: AgentInfo[];
    /** Open chat; `NEW_CHAT` for the start screen of a new one, undefined to pick the latest. */
    chat?: string | undefined;
    onsection: (section: 'plan' | 'docs' | 'tasks') => void;
  } = $props();

  const NEW_CHAT = 'new';

  // The screen is keyed by project.
  // svelte-ignore state_referenced_locally
  const list = new ChatList(project.id);
  void list.reload();
  onDestroy(() => list.dispose());

  let tab = $state<'active' | 'archive'>('active');

  // First visit: the latest active chat, or the start screen when there is none.
  $effect(() => {
    if (list.loaded && chat === undefined) {
      chat = list.chats.find((c) => !c.archived)?.id ?? NEW_CHAT;
    }
  });

  const archivedCount = $derived(list.chats.filter((c) => c.archived).length);
  const shown = $derived(list.chats.filter((c) => c.archived === (tab === 'archive')));
  const tabs = $derived([
    { value: 'active' as const, label: t('chat.tab.active'), tip: t('chat.tab.active.tip') },
    {
      value: 'archive' as const,
      label: archivedCount ? t('chat.tab.archiveN', { n: archivedCount }) : t('chat.tab.archive'),
      tip: t('chat.tab.archive.tip'),
    },
  ]);

  function restore(id: string): void {
    void window.skaro.invoke('chat.archive', project.id, id, false);
  }
</script>

<div class="chat">
  <div class="sessions">
    <button
      type="button"
      class="new"
      data-tip={t('chat.new.tip')}
      onclick={() => {
        tab = 'active';
        chat = NEW_CHAT;
      }}
    >
      <Icon name="edit" size={14} stroke={1.9} />
      {t('chat.new')}
    </button>
    <div class="tabs"><Segmented options={tabs} bind:value={tab} /></div>
    <div class="list">
      {#each shown as item (item.id)}
        <div
          class="row"
          class:on={item.id === chat}
          role="button"
          tabindex="0"
          onclick={() => (chat = item.id)}
          onkeydown={(e) => e.key === 'Enter' && (chat = item.id)}
        >
          <span class="row-title" data-tip={item.title}>{item.title}</span>
          {#if item.live}
            <span class="live" data-tip={t('chat.live')}></span>
          {/if}
          {#if item.archived}
            <button
              type="button"
              class="restore"
              data-tip={t('chat.restore')}
              aria-label={t('chat.restore')}
              onclick={(e) => {
                e.stopPropagation();
                restore(item.id);
              }}
            >
              <Icon name="unarchive" size={14} stroke={1.9} />
            </button>
          {/if}
        </div>
      {/each}
      {#if list.loaded && !shown.length}
        <span class="list-empty"
          >{tab === 'archive' ? t('chat.list.emptyArchive') : t('chat.list.empty')}</span
        >
      {/if}
    </div>
  </div>

  {#if chat !== undefined}
    {#key chat}
      <ChatPane
        projectId={project.id}
        projectPath={project.path}
        {agents}
        chatId={chat === NEW_CHAT ? undefined : chat}
        oncreated={(id) => {
          chat = id;
          void list.reload();
        }}
        {onsection}
      />
    {/key}
  {/if}
</div>

<style>
  .chat {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    background: var(--sk-fill-5);
  }

  .sessions {
    flex: none;
    width: 224px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 10px 12px 14px;
  }

  .new {
    flex: none;
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 11px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--sk-text-7);
    font: inherit;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .new:hover {
    background: var(--sk-fill-13);
    color: var(--sk-text-2);
  }

  .tabs {
    flex: none;
    display: flex;
    justify-content: center;
    margin: 6px 0;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 4px 8px 4px 10px;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    outline: none;
  }

  .row:hover {
    background: var(--sk-fill-13);
  }

  .row.on {
    background: var(--sk-fill-15);
  }

  .row-title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row.on .row-title {
    color: var(--sk-text-6);
  }

  .live {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sk-fill-41);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .restore {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-21);
    cursor: pointer;
  }

  .restore:hover {
    background: var(--sk-fill-23);
    color: var(--sk-text-6);
  }

  .list-empty {
    padding: 18px 10px;
    font-size: var(--sk-fs-4);
    line-height: 1.5;
    color: var(--sk-text-23);
    text-align: center;
    text-wrap: pretty;
  }
</style>
