<script lang="ts">
  import { ConfirmDialog, Icon, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';

  /** "Скопировать" and "Повторить" under the final answer of a turn (mockups 5a, 9g). */
  let {
    text,
    retryOf,
    offset = -8,
  }: {
    text: string;
    /** User message that started the turn: "Повторить" rewinds to it and sends it again. */
    retryOf?: { id: string; text: string } | undefined;
    offset?: number;
  } = $props();

  const feed = useFeed();
  let copied = $state(false);
  let confirm = $state(false);

  function copy(): void {
    void navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="fd-after-final" style="margin-top: {offset}px">
  <button
    type="button"
    class="fd-icon-btn"
    data-tip={copied ? t('feed.msg.copied') : t('feed.msg.copy')}
    aria-label={t('feed.msg.copy')}
    onclick={copy}
  >
    <Icon name={copied ? 'check' : 'copy'} size={14} stroke={copied ? 2.2 : 1.9} />
  </button>
  {#if retryOf && feed.interactive}
    <button
      type="button"
      class="fd-icon-btn"
      data-tip={t('feed.msg.retry')}
      aria-label={t('feed.msg.retry')}
      onclick={() => (confirm = true)}
    >
      <Icon name="reset" size={14} stroke={1.9} />
    </button>
  {/if}
</div>

{#if retryOf}
  <ConfirmDialog
    bind:open={confirm}
    kind="caution"
    icon="reset"
    title={t('feed.confirm.retry.title')}
    text={t('feed.confirm.retry.text')}
    action={t('feed.confirm.retry.action')}
    onconfirm={() => {
      confirm = false;
      void feed.rewind(retryOf.id, { text: retryOf.text });
    }}
  />
{/if}
