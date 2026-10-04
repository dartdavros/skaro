<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  import { importLabel, importMark } from './proposal-format';
  let { state }: { state: ProposalState } = $props();
  const item = $derived(state.item);
  const proposal = $derived(state.proposal);
</script>

{#if proposal.type === 'import'}
  <div class="card import">
    <div class="head bare">
      <Icon name="import" size={14} stroke={1.8} color="var(--sk-text-20)" />
      <span class="title">{t('proposal.import.title')}</span>
    </div>
    <div class="import-rows">
      {#each proposal.groups as group (group.kind)}
        {@const mark = importMark(group)}
        <div class="import-row">
          <span class="import-label">{importLabel(group)}</span>
          <span class="import-mark" class:update={mark.update}>{mark.text}</span>
        </div>
      {/each}
    </div>
    <div class="import-counts">
      <span data-tip={t('proposal.import.skipped.tip')}
        >{t('proposal.import.skipped')} <span class="mono">{proposal.skipped}</span></span
      >
      <span data-tip={t('proposal.import.notes.tip')}
        >{t('proposal.import.notes')} <span class="mono">{proposal.notes}</span></span
      >
    </div>
    {#if state.actionable}
      <div class="foot bare import-foot">
        <button
          type="button"
          class="btn"
          disabled={state.busy}
          onclick={() => void state.decide({ action: 'reject' })}
          ><Icon name="close" size={13} stroke={2.2} />{t('proposal.reject')}</button
        >
        <button
          type="button"
          class="btn primary"
          disabled={state.busy}
          onclick={() => state.feed.reviewImport?.(item.id)}
          ><Icon name="import" size={13} stroke={2} />{t('proposal.import.review')}</button
        >
      </div>
    {/if}
  </div>
{/if}
