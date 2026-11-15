<script lang="ts">
  import { ChevronDown, ChevronRight, ChevronUp, CodeXml, File } from '@lucide/svelte';
  import type { TurnFile } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import DiffModal from './DiffModal.svelte';
  import { isCodePath } from './diff-modal-controller.svelte';
  import './turn-files.css';

  /**
   * "Отредактировал N файлов" and one line per file with its +/− lines, at the end of a turn.
   * A file opens its changes in the diff window; the heading opens the first file.
   */
  let { files, rowId }: { files: TurnFile[]; rowId: string } = $props();

  const feed = useFeed();
  /** The file shown in the diff window, if it is open. */
  let opened = $state<number | undefined>();
  // svelte-ignore state_referenced_locally
  let expanded = $state(feed.rowState?.get(`files:${rowId}`) ?? false);
  $effect(() => {
    feed.rowState?.set(`files:${rowId}`, expanded);
  });
  const visible = $derived(expanded ? files : files.slice(0, 3));
  const hidden = $derived(Math.max(0, files.length - visible.length));
  let root = $state<HTMLDivElement>();
  $effect(() => {
    root?.dispatchEvent(
      new CustomEvent('feed-retain', {
        bubbles: true,
        detail: { id: 'file-diff-viewer', active: opened !== undefined },
      }),
    );
  });

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

<div class="fd-turn-files" bind:this={root}>
  <button type="button" class="line" onclick={() => (opened = 0)}>
    <span class="icon"><Icon name="diffSquare" size={14} stroke={2} /></span>
    <span class="name">{tn('feed.end.files', files.length)}</span>
    {@render counts(added, removed, files.some(counted))}
  </button>
  {#each visible as file, index (file.path)}
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
  {#if files.length > 3}
    <button
      type="button"
      class="line more-files"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span>{expanded ? t('feed.files.hide') : tn('feed.files.more', hidden)}</span>
      {#if expanded}<ChevronUp size={14} strokeWidth={2} />{:else}<ChevronDown
          size={14}
          strokeWidth={2}
        />{/if}
    </button>
  {/if}
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
