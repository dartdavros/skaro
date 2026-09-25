<script lang="ts" generics="T extends string">
  /** Radio cards: a choice with an explanation; a risky option is highlighted yellow. */
  let {
    options,
    value = $bindable(),
    label,
  }: {
    options: { value: T; label: string; note?: string; warn?: boolean }[];
    value: T;
    label?: string;
  } = $props();
</script>

<div class="list" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    {@const on = option.value === value}
    <button
      type="button"
      role="radio"
      aria-checked={on}
      class="card"
      class:on
      class:warn={option.warn}
      onclick={() => (value = option.value)}
    >
      <span class="ring"><span class="dot"></span></span>
      <span class="texts">
        <span class="title">{option.label}</span>
        {#if option.note}<span class="note">{option.note}</span>{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border: none;
    border-radius: var(--sk-radius);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .card:hover {
    background: var(--sk-surface-hover);
  }

  .card.on {
    background: var(--sk-bg);
  }

  .ring {
    flex: none;
    margin-top: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 0 1.5px #3b3b3b;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: transparent;
  }

  .on .ring {
    box-shadow: inset 0 0 0 1.5px var(--sk-text);
  }

  .on .dot {
    background: var(--sk-text);
  }

  .on.warn .ring {
    box-shadow: inset 0 0 0 1.5px var(--sk-warn);
  }

  .on.warn .dot {
    background: var(--sk-warn);
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--sk-text-secondary);
  }

  .on .title {
    color: var(--sk-text);
  }

  .note {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--sk-text-muted);
    text-wrap: pretty;
  }

  .on.warn .note {
    color: #d0a45c;
  }
</style>
