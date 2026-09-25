<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * 04 · Кнопки. Primary — one per screen, blue with white text. Secondary — grey surface.
   * Danger — only inside a confirmation modal ("dangerSolid") or as a soft action ("danger").
   */
  let {
    variant = 'secondary',
    size = 'md',
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary' | 'danger' | 'dangerSolid' | 'ghost';
    size?: 'md' | 'sm';
    children: Snippet;
  } = $props();
</script>

<button class="btn {variant} {size}" type="button" {...rest}>{@render children()}</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 34px;
    padding: 0 14px;
    border: none;
    border-radius: var(--sk-radius);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .sm {
    height: 28px;
    padding: 0 12px;
    border-radius: 7px;
    font-size: 12.5px;
  }

  .primary {
    padding: 0 15px;
    background: var(--sk-accent);
    color: #ffffff;
    font-weight: 700;
  }

  .primary:hover:not(:disabled) {
    background: var(--sk-accent-hover);
  }

  .secondary {
    background: var(--sk-surface-2);
    color: var(--sk-text);
  }

  .secondary:hover:not(:disabled) {
    background: var(--sk-surface-2-hover);
    color: var(--sk-text-bright);
  }

  .danger {
    background: rgba(239, 106, 99, 0.16);
    color: #f08b85;
  }

  .danger:hover:not(:disabled) {
    background: rgba(239, 106, 99, 0.26);
    color: #ffb3ae;
  }

  .dangerSolid {
    padding: 0 15px;
    background: #d9534d;
    color: #ffffff;
    font-weight: 700;
  }

  .dangerSolid:hover:not(:disabled) {
    background: #e5625c;
  }

  .ghost {
    background: transparent;
    color: #8a8a8a;
  }

  .ghost:hover:not(:disabled) {
    background: var(--sk-surface-2);
    color: var(--sk-text);
  }
</style>
