<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { ConfirmDialog, Icon, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { imageUrl } from './format';

  /** What Skaro writes as the first message of an import chat (main: chats.ts). */
  const IMPORT_HEADS = ['Импортировать документацию', 'Import documentation'];

  /** User bubble: queued state, attached images, edit and rewind on hover (mockup 9g). */
  let { row }: { row: Extract<FeedRow, { type: 'user' }> } = $props();

  const feed = useFeed();
  const queued = $derived(row.item.status === 'queued');
  let editing = $state(false);
  let draft = $state('');
  let confirm = $state<'rewind' | 'edit' | undefined>();

  /**
   * The first message of an import chat (AgentChat mockup): "Импортировать документацию" and a
   * line per source in mono ("~/Docs/shop · 42 файла").
   */
  const importLines = $derived.by(() => {
    const [head, ...rest] = row.item.text.split('\n');
    if (!head || !IMPORT_HEADS.includes(head) || !rest.length) return undefined;
    return rest.every((l) => / · \d+ /.test(l)) ? { head, sources: rest } : undefined;
  });

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
      {:else if importLines}
        <span class="import"
          ><span>{importLines.head}</span>{#each importLines.sources as source, i (i)}<span
              class="import-source">{source}</span
            >{/each}</span
        >
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
  .import {
    display: flex;
    flex-direction: column;
    gap: 5px;
    white-space: normal;
  }

  .import-source {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-blue-2);
  }

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
    color: var(--sk-blue-1);
    font: inherit;
    font-size: var(--sk-fs-6);
    line-height: 1.45;
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
    color: var(--sk-blue-2);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--sk-white-a6);
  }

  .thumb-btn {
    padding: 0;
    border: none;
    background: none;
  }
</style>
