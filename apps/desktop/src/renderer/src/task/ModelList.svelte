<script lang="ts">
  import type { AgentModel } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import EffortBars from './EffortBars.svelte';
  import './model-list.css';

  /**
   * The agent's models as a radio list: name, "по умолчанию", description and, on the right, how
   * many effort levels the model has. More than six models scroll inside the list.
   */
  let {
    models,
    value,
    onpick,
  }: { models: AgentModel[]; value: string | undefined; onpick: (id: string) => void } = $props();
</script>

<div
  class="model-list"
  class:scroll={models.length > 6}
  role="radiogroup"
  aria-label={t('agent.model')}
>
  {#each models as m (m.id)}
    {@const on = m.id === value}
    <button
      type="button"
      class="model-row"
      class:on
      role="radio"
      aria-checked={on}
      onclick={() => onpick(m.id)}
    >
      <span class="radio"><span class="radio-dot"></span></span>
      <span class="model-texts">
        <span class="model-head">
          <span class="model-name">{m.name}</span>
          {#if m.isDefault}<span class="model-tag">{t('agent.model.default')}</span>{/if}
        </span>
        {#if m.description}<span class="model-desc">{m.description}</span>{/if}
      </span>
      {#if m.efforts.length > 1}<EffortBars count={m.efforts.length} />{/if}
    </button>
  {/each}
</div>
