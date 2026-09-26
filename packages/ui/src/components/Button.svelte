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
    font-size: var(--sk-fs-6);
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
    font-size: var(--sk-fs-5);
  }

  .primary {
    padding: 0 15px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
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
    background: var(--sk-error-a16);
    color: var(--sk-red-2);
  }

  .danger:hover:not(:disabled) {
    background: var(--sk-error-a26);
    color: var(--sk-red-1);
  }

  .dangerSolid {
    padding: 0 15px;
    background: var(--sk-red-6);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .dangerSolid:hover:not(:disabled) {
    background: var(--sk-red-5);
  }

  .ghost {
    background: transparent;
    color: var(--sk-text-19);
  }

  .ghost:hover:not(:disabled) {
    background: var(--sk-surface-2);
    color: var(--sk-text);
  }
</style>
