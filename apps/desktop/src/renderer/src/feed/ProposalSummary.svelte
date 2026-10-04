<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  let { state }: { state: ProposalState } = $props();
  const summaryLine = $derived(state.summaryLine);
</script>

{#if summaryLine}
  <div class="line">
    <Icon
      name={summaryLine.ok ? 'check' : 'close'}
      size={13}
      stroke={2.4}
      color="var(--sk-text-20)"
    />
    <span class="line-text">{summaryLine.text}</span>
    {#if summaryLine.open && state.feed.openSection}
      {@const section = summaryLine.open}
      <button
        type="button"
        class="line-open"
        data-tip={summaryLine.tip}
        onclick={() => state.feed.openSection?.(section)}
        >{summaryLine.action ?? t('proposal.open')}</button
      >
    {/if}
  </div>
{/if}
