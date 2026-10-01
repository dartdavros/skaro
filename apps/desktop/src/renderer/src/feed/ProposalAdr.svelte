<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  import { segments, adrText } from './proposal-format';
  let { state }: { state: ProposalState } = $props();
  const proposal = $derived(state.proposal);
</script>

{#if proposal.type === 'adr' || proposal.type === 'spec'}
  <div class="card padded">
    <div class="head bare">
      <Icon
        name={proposal.type === 'spec' ? 'spec' : 'adr'}
        size={14}
        stroke={1.8}
        color="var(--sk-text-20)"
      />
      <span class="title"
        >{proposal.type === 'spec' ? 'SPEC' : 'ADR'}-{proposal.id} · {proposal.title}</span
      >
    </div>
    <span class="text"
      >{#each segments(adrText(proposal)) as part, i (i)}{#if part.code}<code>{part.text}</code
          >{:else}{part.text}{/if}{/each}</span
    >
    {#if state.actionable}
      <div class="foot bare">
        <span class="hint"></span>
        <button
          type="button"
          class="btn"
          disabled={state.busy}
          onclick={() => void state.decide({ action: 'reject' })}
          ><Icon name="close" size={13} stroke={2.2} />{t('proposal.reject')}</button
        >
        <button type="button" class="btn" disabled={state.busy} onclick={() => state.startEdit()}
          ><Icon name="eye" size={13} stroke={2} />{t('proposal.view')}</button
        >
        <button
          type="button"
          class="btn primary"
          disabled={state.busy}
          onclick={() => void state.decide({ action: 'apply' })}
          ><Icon name="check" size={13} stroke={2.4} />{t('proposal.accept')}</button
        >
      </div>
    {/if}
  </div>
{/if}
