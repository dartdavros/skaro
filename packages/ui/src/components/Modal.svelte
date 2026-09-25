<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';

  /** Modal: dimmed blurred backdrop, closes on backdrop click and Esc. */
  let {
    open = $bindable(false),
    title,
    subtitle,
    width = 440,
    children,
    footer,
  }: {
    open?: boolean;
    title?: string;
    subtitle?: string;
    width?: number;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  const close = () => (open = false);
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && close()} />

{#if open}
  <div class="backdrop" role="presentation" onclick={close}>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      style="width: {width}px"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => undefined}
    >
      {#if title}
        <div class="head">
          <span class="titles"
            ><span class="title">{title}</span>{#if subtitle}<span class="subtitle">{subtitle}</span
              >{/if}</span
          >
          <button
            type="button"
            class="x"
            data-tip={t('ui.closeEsc')}
            aria-label={t('ui.close')}
            onclick={close}
          >
            <Icon name="close" size={14} stroke={2.2} />
          </button>
        </div>
      {/if}
      {@render children()}
      {#if footer}<div class="footer">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(3px);
  }

  .dialog {
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border-radius: var(--sk-radius-modal);
    background: var(--sk-modal);
    box-shadow:
      0 30px 80px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.04);
    animation: skIn 0.16s ease-out;
    outline: none;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .subtitle {
    font-size: 12px;
    color: var(--sk-text-muted);
  }

  .title {
    font-size: 15px;
    font-weight: 700;
    color: var(--sk-text);
  }

  .x {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-muted);
    cursor: pointer;
  }

  .x:hover {
    background: var(--sk-surface-2);
    color: var(--sk-text-bright);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
