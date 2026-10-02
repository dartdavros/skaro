<script lang="ts">
  import { ChevronRight, CodeXml, File } from '@lucide/svelte';
  import type { TurnFile } from '@skaro/timeline';
  import { Icon, tn } from '@skaro/ui';

  /** "Отредактировал N файлов" and one line per file with its +/− lines, at the end of a turn. */
  let { files }: { files: TurnFile[] } = $props();

  const CODE = /\.(c|cc|cjs|cpp|cs|css|go|h|hpp|html|java|js|json|jsx|kt|mjs|php|py|rb|rs|scss|sh|sql|swift|ts|tsx)$/i;

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
  <div class="line">
    <span class="icon"><Icon name="diffSquare" size={14} stroke={2} /></span>
    <span class="name">{tn('feed.end.files', files.length)}</span>
    {@render counts(added, removed, files.some(counted))}
  </div>
  {#each files as file (file.path)}
    <div class="line">
      <span class="icon">
        {#if CODE.test(file.path)}<CodeXml size={16} strokeWidth={2} />{:else}<File
            size={14}
            strokeWidth={2}
          />{/if}
      </span>
      <span class="name">{name(file.path)}</span>
      {@render counts(file.added ?? 0, file.removed ?? 0, counted(file))}
    </div>
  {/each}
</div>

<style>
  .fd-turn-files {
    display: flex;
    flex-direction: column;
    padding: 3px 6px 3px 7px;
    border: 1px solid #2d2d2d;
    border-radius: 8px;
    font-size: 14px;
    color: #f0efec;
  }

  .line {
    display: flex;
    align-items: center;
    height: 28px;
  }

  .icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-right: 6px;
    color: #878581;
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
    color: #27d74b;
  }

  .minus {
    color: #ff2834;
  }

  .chevron {
    flex: none;
    display: inline-flex;
    margin-left: 10px;
    color: #c3c0b4;
  }
</style>
