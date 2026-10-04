<script lang="ts">
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import { modelName } from '../feed/format';
  import { effortLabel } from '../tasks/agent-models.svelte';
  import type { ImportController } from './import-controller.svelte';
  let { state }: { state: ImportController } = $props();
</script>

<div data-import-modal class="agent">
  <span data-import-modal class="sk-label">{t('import.agent')}</span>
  {#if state.settings}
    <button
      data-import-modal
      type="button"
      class="agent-btn"
      data-tip={t('import.agent.tip')}
      onclick={() => (state.agentModal = true)}
    >
      <AgentLogo agent={state.settings.agent} size={15} />
      {modelName(state.settings.model, state.models)}
      {#if state.effort}<span data-import-modal class="effort">· {effortLabel(state.effort)}</span
        >{/if}
      <Icon name="chevronDown" size={11} stroke={2.4} />
    </button>
  {/if}
</div>
