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
    color: #8a8a8a;
  }

  .round.bright {
    color: var(--sk-text);
  }

  .round:hover:not(:disabled),
  .round.active {
    background: #383838;
    color: #e2e2e2;
  }

  .send {
    border-radius: 50%;
    background: var(--sk-accent);
    color: #ffffff;
  }

  .send:hover:not(:disabled) {
    background: var(--sk-accent-hover);
  }

  .send:disabled {
    opacity: 1;
    background: #3a3a3a;
    color: #8a8a8a;
  }

  .float {
    border-radius: 50%;
    background: rgba(12, 12, 12, 0.72);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.06),
      0 8px 20px rgba(0, 0, 0, 0.45);
    color: var(--sk-text);
  }

  .float:hover {
    background: rgba(30, 30, 30, 0.9);
    color: #ffffff;
  }
</style>
