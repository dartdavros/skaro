<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * Icon buttons: background only on hover. Round ones are used only in the chat input
   * ("round", "send", "float" — the scroll-to-bottom button).
   */
  let {
    tip,
    variant = 'square',
    size = 28,
    tone = 'default',
    active = false,
    children,
    ...rest
  }: HTMLButtonAttributes & {
    tip?: string;
    variant?: 'square' | 'round' | 'send' | 'float';
    size?: number;
    tone?: 'default' | 'muted' | 'bright';
    active?: boolean;
    children: Snippet;
  } = $props();
</script>

<button
  class="ib {variant} {tone}"
  class:active
  type="button"
  data-tip={tip}
  aria-label={tip}
  style="width: {size}px; height: {size}px"
  {...rest}
>
  {@render children()}
</button>

<style>
  .ib {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-icon);
    cursor: pointer;
  }

  .ib:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .muted {
    color: var(--sk-text-muted);
  }

  .bright {
    color: var(--sk-text);
  }

  .square:hover:not(:disabled),
  .square.active {
    background: var(--sk-surface-2);
    color: var(--sk-text-bright);
  }

  .round {
    border-radius: 50%;
    color: var(--sk-text-19);
  }

  .round.bright {
    color: var(--sk-text);
  }

  .round:hover:not(:disabled),
  .round.active {
    background: var(--sk-fill-32);
    color: var(--sk-text-4);
  }

  .send {
    border-radius: 50%;
    background: var(--sk-accent);
    color: var(--sk-text-1);
  }

  .send:hover:not(:disabled) {
    background: var(--sk-accent-hover);
  }

  .send:disabled {
    opacity: 1;
    background: var(--sk-fill-33);
    color: var(--sk-text-19);
  }

  .float {
    border-radius: 50%;
    background: var(--sk-float-a72);
    box-shadow:
      0 0 0 1px var(--sk-white-a6),
      0 8px 20px var(--sk-black-a45);
    color: var(--sk-text);
  }

  .float:hover {
    background: var(--sk-float-hover-a90);
    color: var(--sk-text-1);
  }
</style>
