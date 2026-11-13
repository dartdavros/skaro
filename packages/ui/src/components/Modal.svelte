<script lang="ts">
  import './modal.css';
  import { observeModalLayer, isTopModal } from './modal-layer.svelte';
  import type { Snippet } from 'svelte';
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';

  /** Modal: dimmed blurred backdrop, closes on backdrop click and Esc. */
  let {
    open = $bindable(false),
    title,
    subtitle,
    width = 440,
    closable = true,
    projectScoped = false,
    flush = false,
    children,
    footer,
  }: {
    open?: boolean;
    title?: string;
    subtitle?: string;
    width?: number;
    /** The × in the corner; some mockups close only by Esc, the backdrop and "Отмена". */
    closable?: boolean;
    projectScoped?: boolean;
    /**
     * No inner padding: the head and the footer run edge to edge (the footer on its own band
     * with a line above), the body sets its own padding and scrolls by itself.
     */
    flush?: boolean;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  let root = $state<HTMLElement>();
  $effect(() => {
    if (open && root) return observeModalLayer();
  });
  const close = () => (open = false);
</script>

<svelte:window
  onkeydown={(e) =>
    open &&
    isTopModal(root) &&
    e.key === 'Escape' &&
    !document.fullscreenElement &&
    !document.querySelector('[data-viewer-dialog]') &&
    close()}
/>

{#if open}
  <div class="backdrop sk-modal-backdrop" class:projectScoped role="presentation" onclick={close}>
    <div
      class="dialog sk-modal-dialog"
      bind:this={root}
      data-modal-root
      class:flush
      role="dialog"
      aria-modal={isTopModal(root)}
      aria-label={title}
      tabindex="-1"
      style="width: {width}px"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => undefined}
    >
      {#if title}
        <div class="head sk-modal-head">
          <span class="titles sk-modal-titles"
            ><span class="title sk-modal-title">{title}</span>{#if subtitle}<span
                class="subtitle sk-modal-subtitle">{subtitle}</span
              >{/if}</span
          >
          {#if closable}<button
              type="button"
              class="x sk-modal-x"
              data-tip={t('ui.closeEsc')}
              aria-label={t('ui.close')}
              onclick={close}
            >
              <Icon name="close" size={14} stroke={2.2} />
            </button>{/if}
        </div>
      {/if}
      {@render children()}
      {#if footer}<div class="footer sk-modal-footer">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
