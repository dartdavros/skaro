<script lang="ts">
  import type { NumberedLine } from './diff-model';
  import type { Segment } from './diff-highlight';

  /**
   * The body of the diff window: old number, new number, sign, code. Long diffs render in chunks
   * the browser skips while they are off screen.
   */
  let { lines, colors }: { lines: NumberedLine[]; colors: (Segment[] | undefined)[] | undefined } =
    $props();

  const CHUNK = 60;
  const chunks = $derived(
    Array.from({ length: Math.ceil(lines.length / CHUNK) }, (_, k) => k * CHUNK),
  );
  /** Rows share the width of the longest line, also while some chunks are skipped. */
  const width = $derived(
    lines.reduce((max, l) => Math.max(max, l.text.replace(/\t/g, '    ').length), 0),
  );
</script>

<div class="dm-lines" style="min-width: max(100%, calc(144px + {width}ch))">
  {#each chunks as from (from)}
    <div class="dm-chunk" class:skip={lines.length > CHUNK * 4}>
      {#each lines.slice(from, from + CHUNK) as line, k (from + k)}
        {#if line.kind === 'hunk'}
          <div class="dm-hunk"><span class="dm-hunk-pad"></span><span>{line.text}</span></div>
        {:else}
          <div class="dm-row {line.kind}">
            <span class="dm-num">{line.old ?? ''}</span>
            <span class="dm-num">{line.new ?? ''}</span>
            <span class="dm-sign">{line.sign}</span>
            <span class="dm-code"
              >{#if colors?.[from + k]}{#each colors[from + k]! as seg, s (s)}<span
                    style:color={seg.color}>{seg.text}</span
                  >{/each}{:else}{line.text}{/if}</span
            >
          </div>
        {/if}
      {/each}
    </div>
  {/each}
</div>
