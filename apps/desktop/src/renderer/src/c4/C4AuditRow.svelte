<script lang="ts">
  import {
    Check,
    CircleAlert,
    CircleHelp,
    Clock,
    FileCheck2,
    MessageSquare,
    RotateCw,
    Square,
  } from '@lucide/svelte';
  import { Banner, Button, t } from '@skaro/ui';
  import type { C4Audit } from '../../../shared/c4-audit';
  import { auditActive, auditCanStop } from '../../../shared/c4-audit';
  import { audit } from './audit.svelte';
  import { background } from '../background/background.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import './audit-i18n';
  let { value, onchat }: { value: C4Audit; onchat?: (project: string, chat: string) => void } =
    $props();
  const active = $derived(auditActive(value.state));
  const current = $derived(value.id === audit.current?.id);
  const failed = $derived(['error', 'conflict'].includes(value.state));
  const waiting = $derived(['resource', 'model'].includes(value.state));
  const decision = $derived(value.state === 'decision');
  const detail = $derived(value.error ?? t(`c4.audit.detail.${value.result ?? value.state}`));
</script>

<div class="audit-row" data-c4-audit-row={value.id}>
  <span class="mark" class:failed>
    {#if decision}<CircleHelp size={14} />{:else if waiting}<Clock size={14} />
    {:else if active}<LoadingIndicator size={14} />{:else if failed}<CircleAlert size={14} />
    {:else if value.state === 'stopped'}<Square size={14} />{:else}<Check size={14} />{/if}
  </span>
  <div class="text">
    <span class:failed role={failed ? 'alert' : 'status'}
      >{t('c4.audit.name')} · {t(`c4.audit.state.${value.state}`)}</span
    >
    <span class="detail">{detail}</span>
    {#if current && decision}
      <button class="link" onclick={() => background.openDecision()}
        ><CircleHelp size={16} />{t('background.openDecision')}</button
      >
    {:else if current && active}
      <Button
        data-c4-audit-stop
        size="sm"
        disabled={audit.busy || !auditCanStop(value.state)}
        onclick={() => void audit.command('c4.auditStop', value.id)}
        ><Square size={12} fill="currentColor" strokeWidth={0} />{t('c4.audit.stop')}</Button
      >
    {:else if current && value.state === 'conflict'}
      <Button
        size="sm"
        disabled={audit.busy}
        onclick={() => void audit.command('c4.auditRecover', value.id)}
        ><FileCheck2 size={16} />{t('c4.audit.recover')}</Button
      >
    {:else if current}
      <Button
        size="sm"
        disabled={audit.busy}
        onclick={() => void audit.command('c4.auditStart', value.id)}
      >
        <RotateCw size={16} />{t(value.state === 'error' ? 'c4.audit.retry' : 'c4.audit.again')}
      </Button>
    {/if}
    {#if !active && !decision && value.chatId}<button
        class="link"
        onclick={() => onchat?.(value.projectId, value.chatId!)}
        ><MessageSquare size={16} />{t('decisions.openChat')}</button
      >{/if}
    {#if current && audit.error}<Banner kind="error" text={audit.error} />{/if}
  </div>
</div>

<style>
  .audit-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 112px;
    padding: 8px 0;
    font-size: var(--sk-fs-5);
  }
  .mark {
    flex: none;
    display: inline-flex;
    color: var(--sk-text-secondary);
    margin-top: 2px;
  }
  .failed {
    color: var(--sk-error);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .text :global(button) {
    align-self: flex-start;
  }
  .audit-row :global(button[data-c4-audit-stop]) {
    height: 24px;
    padding: 0 9px;
    gap: 6px;
    border-radius: 6px;
    font-size: var(--sk-fs-2);
  }
  .detail {
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-4);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--sk-link);
    font: inherit;
    font-size: var(--sk-fs-4);
    cursor: pointer;
    text-align: left;
  }
</style>
