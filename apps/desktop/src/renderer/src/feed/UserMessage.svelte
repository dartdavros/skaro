<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { ConfirmDialog, Icon, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { imageUrl } from './format';

  /** User bubble: queued state, attached images, edit and rewind on hover (mockup 9g). */
  let { row }: { row: Extract<FeedRow, { type: 'user' }> } = $props();

  const feed = useFeed();
  const queued = $derived(row.item.status === 'queued');
  let editing = $state(false);
  let draft = $state('');
  let confirm = $state<'rewind' | 'edit' | undefined>();

  function startEdit(): void {
    draft = row.item.text;
    editing = true;
  }

  function run(): void {
    const kind = confirm;
    confirm = undefined;
    if (kind === 'edit') {
      editing = false;
      void feed.rewind(row.item.id, { text: draft.trim() });
    } else {
      void feed.rewind(row.item.id);
    }
  }
</script>

<div class="fd-user">
  {#if editing}
    <div class="fd-bubble editing">
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        bind:value={draft}
        rows="2"
        autofocus
        onkeydown={(e) => e.key === 'Escape' && (editing = false)}></textarea>
      <div class="edit-actions">
        <button type="button" class="cancel" onclick={() => (editing = false)}
          >{t('feed.msg.cancel')}</button
        >
        <button
          type="button"
          class="fd-btn primary"
          disabled={!draft.trim()}
          onclick={() => (confirm = 'edit')}>{t('feed.msg.send')}</button
        >
      </div>
    </div>
  {:else}
    <div class="fd-bubble" class:queued class:with-images={row.images.length > 0}>
      {#if row.images.length}
        <div class="thumbs">
          {#each row.images as image (image.id)}
            <button
              type="button"
              class="thumb-btn"
              onclick={() => feed.viewImage(imageUrl(image.image))}
            >
              <img class="fd-thumb" src={imageUrl(image.image)} alt="" />
            </button>
          {/each}
        </div>
        <span>{row.item.text}</span>
      {:else}
        {row.item.text}
      {/if}
    </div>
    {#if queued}
      <span class="fd-queued-label" data-tip={t('feed.queued.tip')}>{t('feed.queued')}</span>
    {:else if feed.interactive}
      <div class="fd-hover-actions">
        <button
          type="button"
          class="fd-icon-btn"
          data-tip={t('feed.msg.edit')}
          aria-label={t('feed.msg.edit')}
          onclick={startEdit}
        >
          <Icon name="edit" size={14} stroke={1.9} />
        </button>
        <button
          type="button"
          class="fd-icon-btn"
          data-tip={t('feed.msg.rewind')}
          aria-label={t('feed.msg.rewind')}
          onclick={() => (confirm = 'rewind')}
        >
          <Icon name="undo" size={14} stroke={1.9} />
        </button>
      </div>
    {/if}
  {/if}
</div>

<ConfirmDialog
  bind:open={() => confirm !== undefined, (open) => !open && (confirm = undefined)}
  kind="caution"
  icon="undo"
  title={t(`feed.confirm.${confirm ?? 'rewind'}.title`)}
  text={t(`feed.confirm.${confirm ?? 'rewind'}.text`)}
  action={t(`feed.confirm.${confirm ?? 'rewind'}.action`)}
  onconfirm={run}
/>

<style>
  .editing {
    width: 78%;
    padding: 10px 12px 10px 15px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  textarea {
    width: 100%;
    border: none;
    background: transparent;
    color: #dfe5f3;
    font: inherit;
    font-size: 13px;
    line-height: 1.55;
    resize: none;
    outline: none;
    field-sizing: content;
    min-height: 40px;
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .cancel {
    height: 28px;
    padding: 0 11px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: #b8c3dc;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .cancel:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .thumb-btn {
    padding: 0;
    border: none;
    background: none;
  }
</style>
