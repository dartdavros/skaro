<script lang="ts">
  import UserMessageEditor from './UserMessageEditor.svelte';
  import UserMessageBubble from './UserMessageBubble.svelte';
  import { ConfirmDialog, Icon, t } from '@skaro/ui';
  import type { UserMessageProps } from './user-message-props';
  import { createUserMessageController } from './user-message-controller.svelte';
  let { row }: UserMessageProps = $props();
  const state = createUserMessageController({
    get row() {
      return row;
    },
  });
  import './user-message.css';
</script>

<div data-user-message class="fd-user">
  {#if state.editing}
    <UserMessageEditor {state} />
  {:else}
    <UserMessageBubble {state} />
    {#if state.queued}
      <span data-user-message class="fd-queued-label" data-tip={t('feed.queued.tip')}
        >{t('feed.queued')}</span
      >
    {:else if state.feed.interactive}
      <div data-user-message class="fd-hover-actions">
        <button
          data-user-message
          type="button"
          class="fd-icon-btn"
          data-tip={t('feed.msg.edit')}
          aria-label={t('feed.msg.edit')}
          onclick={state.startEdit}
        >
          <Icon name="edit" size={14} stroke={1.9} />
        </button>
        <button
          data-user-message
          type="button"
          class="fd-icon-btn"
          data-tip={t('feed.msg.rewind')}
          aria-label={t('feed.msg.rewind')}
          onclick={() => (state.confirm = 'rewind')}
        >
          <Icon name="undo" size={14} stroke={1.9} />
        </button>
      </div>
    {/if}
  {/if}
</div>

<ConfirmDialog
  bind:open={state.confirmOpen}
  kind="caution"
  icon="undo"
  title={t(`feed.confirm.${state.confirm ?? 'rewind'}.title`)}
  text={t(`feed.confirm.${state.confirm ?? 'rewind'}.text`)}
  action={t(`feed.confirm.${state.confirm ?? 'rewind'}.action`)}
  onconfirm={state.run}
/>
