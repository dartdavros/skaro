<script lang="ts">
  import type { PermissionMode } from '@skaro/timeline';
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import type { AgentId } from '../../../shared/ipc';
  import type { ComposerController } from './composer-controller.svelte';
  import ComposerPermissions from './ComposerPermissions.svelte';
  import EffortBars from './EffortBars.svelte';
  import { effortLabel } from '../tasks/agent-models.svelte';
  import './composer-bar.css';
  import './composer-permissions.css';
  let {
    controller,
    running,
    agent,
    model,
    modelTip,
    effort,
    efforts = [],
    contextPct,
    permissionMode,
    permissionModes,
    planFirst,
    onstop,
    onmodel,
    onpermission,
  }: {
    controller: ComposerController;
    running: boolean;
    agent: AgentId;
    model: string;
    modelTip?: string;
    effort?: string | undefined;
    efforts?: string[];
    contextPct?: number;
    permissionMode?: PermissionMode;
    permissionModes: readonly PermissionMode[];
    planFirst: boolean;
    onstop: () => void;
    onmodel: () => void;
    onpermission?: (mode: PermissionMode) => void;
  } = $props();
  const ctxColor = $derived((contextPct ?? 0) >= 85 ? 'var(--sk-warn)' : 'var(--sk-accent)');
  const ctxDash = $derived(`${((37.7 * (contextPct ?? 0)) / 100).toFixed(1)} 37.7`);
  // A model with a single level (or none) has nothing to choose: no indicator.
  const effortIndex = $derived(effort ? efforts.indexOf(effort) : -1);
  const showEffort = $derived(efforts.length > 1 && effortIndex >= 0);
</script>

<div class="bar">
  <div class="pop-anchor">
    <button
      type="button"
      class="round"
      class:on={controller.menu === 'attach'}
      data-tip={t('composer.attach')}
      aria-label={t('composer.attach')}
      onclick={() => (controller.menu = controller.menu === 'attach' ? undefined : 'attach')}
    >
      <Icon name="plus" size={15} stroke={2.6} />
    </button>
    {#if controller.menu === 'attach'}
      <div class="pop attach">
        <button type="button" class="pop-row" onclick={() => void controller.attach('files')}>
          <Icon name="file" size={14} stroke={1.8} color="var(--sk-text-20)" />{t(
            'composer.attach.file',
          )}
        </button>
        <button type="button" class="pop-row" onclick={() => void controller.attach('folder')}>
          <Icon name="folderOpen" size={14} stroke={1.8} color="var(--sk-text-20)" />{t(
            'composer.attach.folder',
          )}
        </button>
      </div>
    {/if}
  </div>

  <ComposerPermissions {controller} {permissionMode} {permissionModes} {onpermission} />

  {#if planFirst}
    <span class="pill static" data-tip={t('composer.plan.tip')}>
      <Icon name="plan" size={13} stroke={2} />{t('composer.plan')}
    </span>
  {/if}

  <span class="spacer"></span>

  {#if contextPct !== undefined}
    <span class="ctx" data-tip={t('composer.ctx.tip', { n: Math.round(contextPct) })}>
      <svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(-90deg)">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--sk-fill-35)" stroke-width="2.2" />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={ctxColor}
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-dasharray={ctxDash}
        />
      </svg>
    </span>
  {/if}

  <button
    type="button"
    class="model"
    data-tip={modelTip ?? t('composer.model.tip')}
    onclick={onmodel}
  >
    <AgentLogo {agent} size={15} />
    <span>{model}</span>
    {#if showEffort && effort}
      <span class="model-sep"></span>
      <EffortBars count={efforts.length} current={effortIndex} />
      <span class="model-effort">{effortLabel(effort)}</span>
    {/if}
    <Icon name="chevronDown" size={11} stroke={2.4} />
  </button>

  {#if !running || controller.has}
    <button
      type="button"
      class="send"
      class:ready={controller.has}
      disabled={!controller.has || controller.sending}
      data-tip={running ? t('composer.queue') : t('composer.send')}
      aria-label={running ? t('composer.queue') : t('composer.send')}
      onclick={() => void controller.send()}
    >
      <Icon name="send" size={14} stroke={2.3} />
    </button>
  {/if}
  {#if running && !controller.has}
    <button
      type="button"
      class="stop"
      data-tip={t('composer.stop')}
      aria-label={t('composer.stop')}
      onclick={onstop}
    >
      <svg width="16" height="16" viewBox="0 0 16 16"
        ><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"
        ></circle><rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" fill="currentColor"
        ></rect></svg
      >
    </button>
  {/if}
</div>
