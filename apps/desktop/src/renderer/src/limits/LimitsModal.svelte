<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Banner, Button, i18n, Modal, t } from '@skaro/ui';
  import type { AgentInfo } from '../../../shared/ipc';
  import AgentPicker from '../task/AgentPicker.svelte';
  import '../task/agent-modal.css';
  import './i18n';
  import LimitRow from './LimitRow.svelte';
  import BuiltinUsage from './BuiltinUsage.svelte';
  import '../settings/models/i18n';
  import { LimitsController } from './controller.svelte';
  let {
    projectId,
    agents,
    open = $bindable(true),
  }: {
    projectId: string;
    agents: AgentInfo[];
    open?: boolean;
  } = $props();
  const controller = new LimitsController();
  onMount(() => {
    void controller.initialize(projectId);
  });
  onDestroy(() => controller.cancel());
  $effect(() => {
    if (!controller.initialized) return;
    const agent = controller.draft.agent;
    const authenticated = agents.find((a) => a.id === agent)?.authenticated;
    void authenticated;
    void controller.load(agent);
    const timer = setInterval(() => void controller.load(agent), 60_000);
    return () => {
      clearInterval(timer);
      controller.cancel();
    };
  });
  const checked = $derived(
    (controller.snapshot ?? controller.usage)
      ? new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(
          new Date((controller.snapshot ?? controller.usage)!.checkedAt),
        )
      : undefined,
  );
</script>

<Modal
  bind:open
  title={t(controller.draft.agent === 'skaro' ? 'models.usage' : 'limits.title')}
  subtitle={t(controller.draft.agent === 'skaro' ? 'models.projectUsage' : 'limits.account')}
  width={440}
  flush
>
  <div class="agent-settings limits-body" aria-busy={controller.loading}>
    {#if controller.initialized}
      <AgentPicker {agents} draft={controller.draft} locked={false} />
    {/if}
    {#if controller.draft.agent === 'skaro'}
      <BuiltinUsage
        usage={controller.usage}
        loading={controller.loading}
        failed={controller.failed}
      />
    {:else if controller.loading}
      <div class="models-loading" aria-label={t('limits.refresh')}>
        {#each [1, 2] as row (row)}
          <div class="skeleton"><span class="bar"></span><span class="bar thin"></span></div>
        {/each}
      </div>
    {:else if controller.failed}
      <Banner kind="error" text={t('limits.failed')} />
    {:else}
      {#each ['five_hour', 'seven_day'] as kind (kind)}
        <LimitRow
          kind={kind as 'five_hour' | 'seven_day'}
          window={controller.snapshot?.windows.find((w) => w.kind === kind)}
        />
      {/each}
      {#if !controller.snapshot?.windows.length}
        <Banner kind="info" text={t('limits.unavailable')} />
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    <span class="checked">{checked ? t('limits.checked', { time: checked }) : ''}</span>
    <Button
      disabled={controller.loading}
      onclick={() => {
        if (controller.initialized) void controller.load(controller.draft.agent);
        else void controller.initialize(projectId);
      }}>{t('limits.refresh')}</Button
    >
  {/snippet}
</Modal>

<style>
  .checked {
    flex: 1;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }
</style>
