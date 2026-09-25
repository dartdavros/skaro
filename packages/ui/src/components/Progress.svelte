<script lang="ts">
  /** Progress: shades of grey only; brighter when complete (milestone progress). */
  let { done, total, id, label }: { done: number; total: number; id?: string; label?: string } =
    $props();

  const pct = $derived(total > 0 ? Math.round((done / total) * 100) : 0);
  const complete = $derived(total > 0 && done >= total);
</script>

<div class="progress">
  {#if label || id}
    <div class="head">
      {#if id}<span class="id">{id}</span>{/if}
      <span class="label">{label ?? ''}</span>
      <span class="count">{done} / {total}</span>
    </div>
  {/if}
  <div
    class="bar"
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={total}
    aria-valuenow={done}
    aria-label={label}
  >
    <div class="fill" class:complete style="width: {pct}%"></div>
  </div>
</div>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 7px;
  }

  .id {
    font-family: var(--sk-mono);
    font-size: 11.5px;
    font-weight: 600;
    color: #a1a1a1;
  }

  .label {
    flex: 1;
    font-size: 13px;
    color: var(--sk-text);
  }

  .count {
    font-family: var(--sk-mono);
    font-size: 11.5px;
    color: var(--sk-icon);
  }

  .bar {
    height: 4px;
    border-radius: 3px;
    background: var(--sk-surface-2);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 3px;
    background: var(--sk-text-label);
    transition: width 0.3s ease;
  }

  .fill.complete {
    background: var(--sk-text-secondary);
  }
</style>
