<script lang="ts">
  import { ChevronRight, CodeXml, File } from '@lucide/svelte';
  import type { TurnFile } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import DiffModal from './DiffModal.svelte';
  import { isCodePath } from './diff-modal-controller.svelte';

  /**
   * "Отредактировал N файлов" and one line per file with its +/− lines, at the end of a turn.
   * A file opens its changes in the diff window; the heading opens the first file.
   */
  let { files }: { files: TurnFile[] } = $props();

  const feed = useFeed();
  /** The file shown in the diff window, if it is open. */
  let opened = $state<number | undefined>();

  const added = $derived(files.reduce((sum, f) => sum + (f.added ?? 0), 0));
  const removed = $derived(files.reduce((sum, f) => sum + (f.removed ?? 0), 0));
  const counted = (f: TurnFile): boolean => f.added !== undefined || f.removed !== undefined;
  const name = (path: string): string => path.split(/[\\/]/).pop() || path;
</script>

{#snippet counts(plus: number, minus: number, shown = true)}
  {#if shown}
    <span class="counts"><span class="plus">+{plus}</span><span class="minus">−{minus}</span></span>
  {/if}
  <span class="chevron"><ChevronRight size={16} strokeWidth={2} /></span>
{/snippet}

<div class="fd-turn-files">
  <button type="button" class="line" onclick={() => (opened = 0)}>
    <span class="icon"><Icon name="diffSquare" size={14} stroke={2} /></span>
    <span class="name">{tn('feed.end.files', files.length)}</span>
    {@render counts(added, removed, files.some(counted))}
  </button>
  {#each files as file, index (file.path)}
    <button type="button" class="line" data-tip={t('diff.open')} onclick={() => (opened = index)}>
      <span class="icon">
        {#if isCodePath(file.path)}<CodeXml size={16} strokeWidth={2} />{:else}<File
            size={14}
            strokeWidth={2}
          />{/if}
      </span>
      <span class="name">{name(file.path)}</span>
      {@render counts(file.added ?? 0, file.removed ?? 0, counted(file))}
    </button>
  {/each}
</div>

{#if opened !== undefined}
  <DiffModal
    {files}
    start={opened}
    cwd={feed.cwd}
    load={(path) => feed.fileDiff(path)}
    onclose={() => (opened = undefined)}
  />
{/if}

<style>
  .fd-turn-files {
    display: flex;
    flex-direction: column;
    padding: 3px;
    border: 1px solid var(--sk-fill-27);
    border-radius: 8px;
    font-size: 14px;
    color: var(--sk-text-reply);
  }

  .line {
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 6px 0 7px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .line:hover {
    background: var(--sk-surface);
  }

  .icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-right: 6px;
    color: var(--sk-diff-icon);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .counts {
    flex: none;
    display: inline-flex;
    gap: 3px;
    margin-left: 12px;
  }

  .plus {
    color: var(--sk-diff-plus);
  }

  .minus {
    color: var(--sk-diff-minus);
  }

  .chevron {
    flex: none;
    display: inline-flex;
    margin-left: 10px;
    color: var(--sk-diff-chevron);
  }
</style>
