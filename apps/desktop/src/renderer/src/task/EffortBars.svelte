<script lang="ts">
  /**
   * Effort as rising bars, one per level of the model (4 to 11px). Up to `current` they are lit
   * with the accent; without `current` all bars stay grey (the model list of the agent modal).
   */
  let { count, current = -1 }: { count: number; current?: number } = $props();

  const height = (k: number) => 4 + Math.round((7 * k) / Math.max(1, count - 1));
</script>

<span class="bars" class:muted={current < 0}>
  {#each { length: count }, k (k)}
    <span class="bar" class:on={k <= current} style="height: {height(k)}px"></span>
  {/each}
</span>

<style>
  .bars {
    flex: none;
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 11px;
  }

  .bars.muted {
    opacity: 0.9;
  }

  .bar {
    width: 3px;
    border-radius: 1px;
    background: var(--sk-fill-36);
  }

  .bars.muted .bar {
    background: var(--sk-fill-35);
  }

  .bar.on {
    background: var(--sk-accent);
  }
</style>
