<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';

  /** Banner: text in the single colour of its kind. */
  let {
    kind = 'warning',
    title,
    text,
    action,
    onaction,
    onclose,
  }: {
    kind?: 'warning' | 'error' | 'info';
    title?: string;
    text?: string;
    action?: string;
    onaction?: () => void;
    onclose?: () => void;
  } = $props();

  const icon = $derived(kind === 'error' ? 'error' : kind === 'info' ? 'info' : 'warning');
</script>

<div class="banner {kind}" role={kind === 'error' ? 'alert' : 'status'}>
  <Icon name={icon} size={16} stroke={1.9} />
  <span class="body"
    >{#if title}<strong>{title}</strong>{/if}
    {text ?? ''}</span
  >
  {#if action}<button type="button" class="action" onclick={onaction}>{action}</button>{/if}
  {#if onclose}
    <button
      type="button"
      class="close"
      data-tip={t('ui.hide')}
      aria-label={t('ui.hide')}
      onclick={onclose}
    >
      <Icon name="close" size={13} stroke={2.2} />
    </button>
  {/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 12px 11px 14px;
    border-radius: 9px;
  }

  .warning {
    background: rgba(224, 163, 60, 0.1);
    color: var(--sk-warn);
  }

  .error {
    background: rgba(239, 106, 99, 0.1);
    color: var(--sk-error);
  }

  .info {
    background: rgba(42, 82, 190, 0.14);
    color: var(--sk-link);
  }

  .body {
    flex: 1;
    min-width: 0;
    font-size: 13px;
  }

  strong {
    font-weight: 600;
  }

  .action {
    flex: none;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .action:hover {
    text-decoration: underline;
  }

  .close {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .close:hover {
    background: rgba(255, 255, 255, 0.06);
  }
</style>
