<script lang="ts">
  import type { SelectOptionItem } from './select-option.ts';

  /** One row of the Select menu: check mark, label with an optional tag, explanation. */
  let {
    option,
    selected,
    onpick,
  }: { option: SelectOptionItem; selected: boolean; onpick: () => void } = $props();
</script>

<div
  data-select
  class="option"
  class:selected
  role="option"
  aria-selected={selected}
  tabindex="-1"
  onclick={onpick}
  onkeydown={(e) => {
    if (e.key === 'Enter') onpick();
  }}
>
  <span data-select class="check">
    <svg
      data-select
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"><path data-select d="M20 6 9 17l-5-5" /></svg
    >
  </span>
  <div data-select class="texts">
    <span data-select class="name"
      >{option.label}{#if option.tag}<span data-select class="tag">{option.tag}</span>{/if}</span
    >
    {#if option.description}<span data-select class="description">{option.description}</span>{/if}
  </div>
</div>
