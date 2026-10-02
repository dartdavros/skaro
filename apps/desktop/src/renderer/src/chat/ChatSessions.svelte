<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ChatScreenController } from './chat-screen-controller.svelte';
  let { state }: { state: ChatScreenController } = $props();
</script>

<div data-chat-screen class="sessions">
  <button
    data-chat-screen
    type="button"
    class="new"
    data-tip={t('chat.new.tip')}
    onclick={() => {
      state.tab = 'active';
      state.p.chat = 'new';
    }}
  >
    <Icon name="edit" size={14} stroke={1.9} />
    {t('chat.new')}
  </button>
  <div data-chat-screen class="list">
    {#each state.shown as item (item.id)}
      <div
        data-chat-screen
        class="row"
        class:on={item.id === state.p.chat}
        role="button"
        tabindex="0"
        onclick={() => (state.p.chat = item.id)}
        onkeydown={(e) => e.key === 'Enter' && (state.p.chat = item.id)}
      >
        {#if item.kind === 'import'}
          <span data-chat-screen class="row-icon" data-tip={t('chat.import.tip')}
            ><Icon name="import" size={14} stroke={1.8} /></span
          >
        {/if}
        <span data-chat-screen class="row-title" data-tip={item.title}>{item.title}</span>
        {#if item.live}
          <span data-chat-screen class="live" data-tip={t('chat.live')}></span>
        {/if}
        {#if item.archived}
          <button
            data-chat-screen
            type="button"
            class="restore"
            data-tip={t('chat.restore')}
            aria-label={t('chat.restore')}
            onclick={(e) => {
              e.stopPropagation();
              state.restore(item.id);
            }}
          >
            <Icon name="unarchive" size={14} stroke={1.9} />
          </button>
        {/if}
      </div>
    {/each}
    {#if state.list.loaded && !state.shown.length}
      <span data-chat-screen class="list-empty"
        >{state.tab === 'archive' ? t('chat.list.emptyArchive') : t('chat.list.empty')}</span
      >
    {/if}
  </div>
  <div data-chat-screen class="foot">
    <button
      data-chat-screen
      type="button"
      class="archive-toggle"
      class:on={state.tab === 'archive'}
      data-tip={state.archiveTip}
      aria-label={state.archiveTip}
      aria-pressed={state.tab === 'archive'}
      onclick={() => (state.tab = state.tab === 'archive' ? 'active' : 'archive')}
    >
      <Icon name="archive" size={15} stroke={1.8} />
    </button>
  </div>
</div>
