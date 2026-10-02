<script lang="ts">
  import { AgentLogo, EffortSlider, Select, t, tn } from '@skaro/ui';
  import { agents } from '../agents.svelte';
  import Dialog from './Dialog.svelte';
  import { AGENT_NAMES } from './model';
  import type { AssignmentProps } from './assignment-props';
  import { createAssignmentController } from './assignment-controller.svelte';
  let { projectId, count, onconfirm, onclose }: AssignmentProps = $props();
  const state = createAssignmentController({
    get projectId() {
      return projectId;
    },
    get count() {
      return count;
    },
    get onconfirm() {
      return onconfirm;
    },
    get onclose() {
      return onclose;
    },
  });

  import './assign-dialog.css';
</script>

<Dialog width={452} {onclose}>
  <div data-task-assign-dialog class="head">
    <div data-task-assign-dialog class="title">{t('board.assign')}</div>
    <div data-task-assign-dialog class="sub">{tn('board.as.sub', count)}</div>
  </div>

  <div data-task-assign-dialog class="agents">
    {#each ['claude-code', 'codex'] as const as id (id)}
      {@const info = agents.list.find((a) => a.id === id)}
      <div
        data-task-assign-dialog
        class="agent"
        class:on={state.agent === id}
        role="radio"
        aria-checked={state.agent === id}
        tabindex="0"
        onclick={() => state.pick(id)}
        onkeydown={(e) => e.key === 'Enter' && state.pick(id)}
      >
        <span data-task-assign-dialog class="logo"><AgentLogo agent={id} size={18} /></span>
        <div data-task-assign-dialog class="names">
          <span data-task-assign-dialog class="name">{AGENT_NAMES[id]}</span>
          <span data-task-assign-dialog class="state">{state.agentState(info)}</span>
        </div>
      </div>
    {/each}
  </div>

  <div data-task-assign-dialog class="fields">
    <div data-task-assign-dialog class="field">
      <span data-task-assign-dialog class="label">{t('board.as.model')}</span>
      <div data-task-assign-dialog data-tip={t('board.as.model.tip')}>
        <Select
          width="100%"
          menuWidth={260}
          label={t('board.as.model')}
          options={state.models.list.map((m) => ({
            value: m.id,
            label: m.name,
            description: m.description,
          }))}
          bind:value={() => state.model?.id ?? '', state.onmodel}
        />
      </div>
    </div>
    {#if state.levels.length}
      <div data-task-assign-dialog class="field">
        <span data-task-assign-dialog class="label">{t('board.as.effort')}</span>
        <EffortSlider
          levels={state.levels}
          bind:value={state.effort}
          defaultValue={state.model?.defaultEffort}
        />
        {#if state.note}<span data-task-assign-dialog class="note">{state.note}</span>{/if}
      </div>
    {/if}
  </div>

  <div data-task-assign-dialog class="footer">
    <span data-task-assign-dialog class="hint">{t('board.as.hint')}</span>
    <button data-task-assign-dialog type="button" class="cancel" onclick={onclose}
      >{t('ui.cancel')}</button
    >
    <button
      data-task-assign-dialog
      type="button"
      class="confirm"
      onclick={() =>
        onconfirm({
          agent: state.agent,
          ...(state.model ? { model: state.model.id } : {}),
          ...(state.effort ? { effort: state.effort } : {}),
        })}>{t('board.as.action')}</button
    >
  </div>
</Dialog>
