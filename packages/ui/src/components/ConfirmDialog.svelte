<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import type { IconName } from '../icons.ts';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  /**
   * Confirmation for actions with tasks (delete, move, archive, unblock). Kinds follow the Tasks
   * screen: danger — red icon and button; caution — amber icon; neutral — grey icon.
   */
  let {
    open = $bindable(false),
    title,
    text,
    hint,
    action,
    kind = 'danger',
    icon = 'trash',
    onconfirm,
  }: {
    open?: boolean;
    title: string;
    text?: string;
    hint?: string;
    action: string;
    kind?: 'danger' | 'caution' | 'neutral';
    icon?: IconName;
    onconfirm: () => void;
  } = $props();

  const close = () => (open = false);
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && close()} />

{#if open}
  <div class="backdrop" role="presentation" onclick={close}>
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => undefined}
    >
      <div class="top">
        <span class="badge {kind}"><Icon name={icon} size={16} stroke={1.9} /></span>
        <div class="texts">
          <span class="title">{title}</span>
          {#if text}<span class="text">{text}</span>{/if}
          {#if hint}<span class="hint">{hint}</span>{/if}
        </div>
      </div>
      <div class="footer">
        <Button onclick={close}>{t('ui.cancel')}</Button>
        <Button
          variant={kind === 'danger' ? 'dangerSolid' : 'primary'}
          onclick={() => {
            close();
            onconfirm();
          }}>{action}</Button
        >
      </div>
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
    width: 400px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    border-radius: var(--sk-radius-modal);
    background: var(--sk-modal);
    box-shadow:
      0 30px 80px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.04);
    animation: skIn 0.16s ease-out;
    outline: none;
  }

  .top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .badge {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .danger {
    background: rgba(239, 106, 99, 0.14);
    color: var(--sk-error);
  }

  .caution {
    background: #332508;
    color: #e8b356;
  }

  .neutral {
    background: var(--sk-surface-2);
    color: var(--sk-text-body);
  }

  .texts {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .title {
    font-size: 15px;
    font-weight: 700;
    color: var(--sk-text);
  }

  .text {
    font-size: 13px;
    line-height: 1.55;
    color: #8a8a8a;
    text-wrap: pretty;
  }

  .hint {
    font-size: 12px;
    line-height: 1.5;
    color: var(--sk-text-label);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
