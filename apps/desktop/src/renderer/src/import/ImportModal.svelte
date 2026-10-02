<script lang="ts">
  import { Icon, Modal, t } from '@skaro/ui';
  import AgentModal from '../task/AgentModal.svelte';
  import './i18n';
  import ImportDropZone from './ImportDropZone.svelte';
  import ImportSources from './ImportSources.svelte';
  import ImportAgentChoice from './ImportAgentChoice.svelte';
  import type { ImportProps } from './import-props';
  import { createImportController } from './import-controller.svelte';
  let { projectId, agents, onclose, onstart }: ImportProps = $props();
  const state = createImportController({
    get projectId() {
      return projectId;
    },
    get agents() {
      return agents;
    },
    get onclose() {
      return onclose;
    },
    get onstart() {
      return onstart;
    },
  });

  import './import-modal.css';
</script>

<Modal bind:open={state.open} width={540} title={t('import.title')} subtitle={t('import.subtitle')}>
  <div data-import-modal class="body">
    {#if state.missing.length}
      <div data-import-modal class="alert" role="alert">
        <Icon name="errorCircle" size={16} stroke={1.9} />
        <span data-import-modal class="alert-text"
          ><strong data-import-modal>{t('import.missing.title')}</strong>
          {t('import.missing.text.before')}<span data-import-modal class="mono"
            >{state.missing[0]!.display}</span
          >{t('import.missing.text.after')}</span
        >
      </div>
    {:else if state.error}
      <div data-import-modal class="alert" role="alert">
        <Icon name="errorCircle" size={16} stroke={1.9} />
        <span data-import-modal class="alert-text">{state.error}</span>
      </div>
    {/if}

    <ImportDropZone {state} />

    <ImportSources {state} />

    {#if state.hasCode}<span data-import-modal class="note">{t('import.code')}</span>{/if}

    <ImportAgentChoice {state} />
  </div>
  {#snippet footer()}
    <button data-import-modal type="button" class="cancel" onclick={() => (state.open = false)}
      >{t('ui.cancel')}</button
    >
    <button
      data-import-modal
      type="button"
      class="start"
      class:ok={state.ok}
      disabled={!state.ok}
      data-tip={state.ok || state.busy
        ? undefined
        : state.sources.length
          ? t('import.start.unreadable')
          : t('import.start.empty')}
      onclick={() => void state.start()}>{t('import.start')}</button
    >
  {/snippet}
</Modal>

{#if state.modalSettings}
  <AgentModal
    bind:open={state.agentModal}
    kind="chat"
    {projectId}
    settings={state.modalSettings}
    {agents}
    locked={false}
    onsave={async (next) => {
      state.settings = {
        agent: next.agent,
        ...(next.model ? { model: next.model } : {}),
        ...(next.effort ? { effort: next.effort } : {}),
        ...(next.permissionMode === 'full' ? { permissionMode: 'full' as const } : {}),
      };
    }}
  />
{/if}
