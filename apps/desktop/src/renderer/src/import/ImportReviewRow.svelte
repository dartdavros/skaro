<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ImportReviewState } from './import-review-state.svelte';
  import { sourceLabel } from './import-review-format';
  import type { ImportReviewItem } from '../../../shared/ipc';
  let {
    state,
    item,
    indent,
  }: { state: ImportReviewState; item: ImportReviewItem; indent: boolean } = $props();
  const checked = $derived(state.on(item.key));
</script>

<div
  class="row"
  class:on={state.selected === item.key}
  role="button"
  tabindex="0"
  style="padding-left: {indent ? 36 : 10}px"
  onclick={() => (state.selected = item.key)}
  onkeydown={(e) => e.key === 'Enter' && (state.selected = item.key)}
>
  <span
    class="box"
    class:checked
    role="checkbox"
    aria-checked={checked}
    tabindex="0"
    onclick={(e) => {
      e.stopPropagation();
      state.toggle(item);
    }}
    onkeydown={(e) => e.key === ' ' && state.toggle(item)}
    >{#if checked}<Icon name="check" size={11} stroke={3.2} color="var(--sk-text-3)" />{/if}</span
  >
  {#if item.type === 'milestone'}<span class="ms">{state.code(item)}</span>{/if}
  <span class="row-title" class:off={!checked}>{item.title}</span>
  {#if state.dangling(item)}<span class="dangling" data-tip={t('import.review.dangling')}
    ></span>{/if}
  <span class="mark" class:update={item.update}
    >{item.update ? t('import.review.update') : t('import.review.new')}</span
  >
  <span class="src" data-tip={item.sources.map(sourceLabel).join('\n')}>{item.sources.length}</span>
</div>
