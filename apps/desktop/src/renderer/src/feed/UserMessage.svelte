<script lang="ts">
  import UserMessageBubble from './UserMessageBubble.svelte';
  import { t } from '@skaro/ui';
  import { sentAt } from '../ago';
  import { clock } from './context.svelte';
  import CopyButton from './CopyButton.svelte';
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
  <UserMessageBubble {state} />
  {#if state.queued}
    <span data-user-message class="fd-queued-label" data-tip={t('feed.queued.tip')}
      >{t('feed.queued')}</span
    >
  {:else}
    <div data-user-message class="fd-hover-actions">
      <span data-user-message class="fd-sent-at">{sentAt(row.item.startedAt, clock.now)}</span>
      <CopyButton text={row.item.text} label={t('feed.msg.copyMessage')} />
    </div>
  {/if}
</div>
