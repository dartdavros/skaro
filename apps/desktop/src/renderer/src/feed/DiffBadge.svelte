<script lang="ts">
  /** "+a −r" pill to the right of a collapsed action group with file edits. */
  let { added, removed }: { added: number; removed: number } = $props();
</script>

<span class="fd-diff-badge"
  ><span class="plus">+{added}</span><span class="minus">−{removed}</span></span
>

<style>
  .fd-diff-badge {
    flex: none;
    display: inline-flex;
    height: 16px;
    margin-left: 3px;
    border-radius: 3px;
    overflow: hidden;
    font-family: var(--sk-mono);
    font-size: 11px;
    font-weight: 500;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
  }

  .plus,
  .minus {
    padding: 0 4px;
  }

  .plus {
    background: #1b3c20;
    color: #2ad73c;
  }

  .minus {
    background: #441a22;
    color: #ff2a51;
  }
</style>
