<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ImportReviewState } from './import-review-state.svelte';
  import type { ImportReviewItem } from '../../../shared/ipc';
  let {
    state,
    label,
    list,
  }: { state: ImportReviewState; label: string; list: ImportReviewItem[] } = $props();
  const n = $derived(list.filter((i) => state.on(i.key)).length);
</script>

<div class="group">
  <span
    class="box"
    class:checked={n === list.length}
    class:part={n > 0 && n < list.length}
    role="checkbox"
    aria-checked={n === list.length ? true : n ? 'mixed' : false}
    tabindex="0"
    data-tip={n === list.length ? t('import.review.none.all') : t('import.review.all')}
    onclick={() => state.toggleGroup(list)}
    onkeydown={(e) => e.key === ' ' && state.toggleGroup(list)}
    >{#if n === list.length}<Icon
        name="check"
        size={11}
        stroke={3.2}
        color="var(--sk-text-3)"
      />{:else if n}<span class="dash"></span>{/if}</span
  >
  <span class="group-label">{label}</span>
  <span class="group-count">{t('import.review.count', { n, of: list.length })}</span>
</div>
