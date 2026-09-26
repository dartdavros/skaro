<script lang="ts">
  import { AgentLogo, EffortSlider, Select, t, tn } from '@skaro/ui';
  import {
    agentReady,
    type AgentId,
    type AgentInfo,
    type TaskAssignment,
  } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import { AgentModels, effortLabel } from './agent-models.svelte';
  import Dialog from './Dialog.svelte';
  import { AGENT_NAMES } from './model';

  /** "Назначить агента" (Tasks mockup): agent, model and effort for the selected tasks. */
  let {
    projectId,
    count,
    onconfirm,
    onclose,
  }: {
    projectId: string;
    count: number;
    onconfirm: (assignment: TaskAssignment) => void;
    onclose: () => void;
  } = $props();

  let agent = $state<AgentId>(agents.list.find(agentReady)?.id ?? 'claude-code');
  let modelId = $state('');
  let effort = $state('');
  const models = new AgentModels();

  $effect(() => {
    const id = agent;
    void models.load(id, projectId).then(() => {
      modelId = models.model()?.id ?? '';
      effort = models.effort(models.model()) ?? '';
    });
  });

  const model = $derived(models.model(modelId));
  const levels = $derived(
    (model?.efforts ?? []).map((e) => ({ id: e.id, label: effortLabel(e.id) })),
  );
  const note = $derived.by(() => {
    const key = `board.as.effort.${effort}`;
    const text = t(key);
    return text === key ? '' : text;
  });

  function agentState(info: AgentInfo | undefined): string {
    if (!info) return '';
    if (agentReady(info)) return t('board.as.ready');
    if (!info.installed) return t('settings.agent.notLoaded.tip');
    return t('settings.agent.signedOut');
  }

  function pick(id: AgentId): void {
    if (id === agent) return;
    agent = id;
    modelId = '';
  }

  function onmodel(id: string): void {
    modelId = id;
    effort = models.effort(models.model(id), effort) ?? '';
  }
</script>

<Dialog width={452} {onclose}>
  <div class="head">
    <div class="title">{t('board.assign')}</div>
    <div class="sub">{tn('board.as.sub', count)}</div>
  </div>

  <div class="agents">
    {#each ['claude-code', 'codex'] as const as id (id)}
      {@const info = agents.list.find((a) => a.id === id)}
      <div
        class="agent"
        class:on={agent === id}
        role="radio"
        aria-checked={agent === id}
        tabindex="0"
        onclick={() => pick(id)}
        onkeydown={(e) => e.key === 'Enter' && pick(id)}
      >
        <span class="logo"><AgentLogo agent={id} size={18} /></span>
        <div class="names">
          <span class="name">{AGENT_NAMES[id]}</span>
          <span class="state">{agentState(info)}</span>
        </div>
      </div>
    {/each}
  </div>

  <div class="fields">
    <div class="field">
      <span class="label">{t('board.as.model')}</span>
      <div data-tip={t('board.as.model.tip')}>
        <Select
          width="100%"
          menuWidth={260}
          label={t('board.as.model')}
          options={models.list.map((m) => ({
            value: m.id,
            label: m.name,
            description: m.description,
          }))}
          bind:value={() => model?.id ?? '', onmodel}
        />
      </div>
    </div>
    {#if levels.length}
      <div class="field">
        <span class="label">{t('board.as.effort')}</span>
        <EffortSlider {levels} bind:value={effort} defaultValue={model?.defaultEffort} />
        {#if note}<span class="note">{note}</span>{/if}
      </div>
    {/if}
  </div>

  <div class="footer">
    <span class="hint">{t('board.as.hint')}</span>
    <button type="button" class="cancel" onclick={onclose}>{t('ui.cancel')}</button>
    <button
      type="button"
      class="confirm"
      onclick={() =>
        onconfirm({
          agent,
          ...(model ? { model: model.id } : {}),
          ...(effort ? { effort } : {}),
        })}>{t('board.as.action')}</button
    >
  </div>
</Dialog>

<style>
  .head {
    padding: 18px 20px 14px;
  }

  .title {
    font-size: var(--sk-fs-11);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .sub {
    margin-top: 5px;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-17);
  }

  .agents {
    padding: 0 20px;
    display: flex;
    gap: 9px;
  }

  .agent {
    flex: 1;
    padding: 13px 14px;
    border-radius: 10px;
    background: var(--sk-fill-11);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    outline: none;
    color: var(--sk-text-19);
  }

  .agent:hover {
    background: var(--sk-fill-15);
  }

  .agent.on {
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
  }

  .logo {
    flex: none;
    display: inline-flex;
  }

  .names {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-6);
  }

  .state {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-13);
  }

  .fields {
    padding: 16px 20px 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  .footer {
    padding: 18px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .hint {
    flex: 1;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .cancel,
  .confirm {
    flex: none;
    height: 32px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-5);
    cursor: pointer;
  }

  .cancel {
    padding: 0 13px;
    background: var(--sk-fill-23);
    color: var(--sk-text-10);
    font-weight: 600;
  }

  .cancel:hover {
    background: var(--sk-fill-29);
    color: var(--sk-text-2);
  }

  .confirm {
    padding: 0 15px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .confirm:hover {
    background: var(--sk-accent-hover);
  }
</style>
