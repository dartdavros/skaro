<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  import ProposalReplanActions from './ProposalReplanActions.svelte';
  import '../c4/i18n';
  import './architecture-review-i18n';
  let { state }: { state: ProposalState } = $props();
  const item = $derived(state.item);
  const proposal = $derived(state.proposal);
  const diff = $derived(state.diff);
</script>

{#if (proposal.type === 'doc' || proposal.type === 'task' || proposal.type === 'spec_change' || proposal.type === 'task_replan' || proposal.type === 'architecture') && diff}
  <div class="card flush">
    <div class="head">
      <Icon
        name={proposal.type === 'spec_change' ? 'spec' : 'file'}
        size={14}
        stroke={1.8}
        color="var(--sk-text-20)"
      />
      <span class="title"
        >{proposal.type === 'task_replan' || proposal.type === 'architecture'
          ? proposal.title
          : proposal.type === 'task'
            ? t('proposal.task.update', { id: proposal.id, title: proposal.title })
            : proposal.type === 'spec_change'
              ? t('proposal.spec.update', { id: proposal.id })
              : proposal.before === undefined
                ? t('proposal.doc.create', { path: proposal.path })
                : t('proposal.doc.update', { path: proposal.path })}</span
      >
      {#if diff.stats}<span class="stats"
          ><span class="add">+{diff.stats.added}</span><span class="del">−{diff.stats.removed}</span
          ></span
        >{/if}
    </div>
    <div class="diff">
      {#if diff.unavailable}<span class="ctx">{t('c4.review.unavailable')}</span>{/if}
      {#each diff.lines as line, i (i)}
        {#if line.gap}
          <span class="ctx">⋯</span>
        {:else}
          <span class:add={line.op === '+'} class:del={line.op === '-'} class:ctx={line.op === ' '}
            >{line.op === ' ' ? ' ' : line.op} {line.text}</span
          >
        {/if}
      {/each}
      {#if diff.more}<span class="ctx">⋯</span>{/if}
    </div>
    {#if proposal.type === 'task_replan'}
      <ProposalReplanActions {state} />
    {:else}
      <div class="foot">
        <span class="hint"
          >{item.result?.error ??
            (item.state === 'pending'
              ? proposal.type === 'doc' || proposal.type === 'spec_change'
                ? t('proposal.hint.manual')
                : ''
              : proposal.type === 'architecture' && item.state === 'accepted'
                ? t('c4.applying')
                : t(`proposal.hint.${item.state}`))}</span
        >
        <button type="button" class="btn" onclick={() => (state.viewer = true)}
          ><Icon name="eye" size={13} stroke={2} />{t('proposal.open')}</button
        >
        {#if state.actionable && (item.state === 'pending' || (proposal.type === 'architecture' && item.state === 'accepted' && item.result?.error))}
          {#if item.state === 'pending'}
            <button
              type="button"
              class="btn"
              disabled={state.busy}
              onclick={() => void state.decide({ action: 'reject' })}
              ><Icon name="close" size={13} stroke={2.2} />{t('proposal.reject')}</button
            >
          {/if}
          <button
            type="button"
            class="btn primary"
            disabled={state.busy}
            onclick={() => void state.decide({ action: 'apply' })}
            ><Icon name="check" size={13} stroke={2.4} />{t('proposal.apply')}</button
          >
        {:else if state.actionable && item.state === 'applied' && proposal.type === 'doc'}
          <button
            type="button"
            class="btn"
            disabled={state.busy}
            onclick={() => void state.decide({ action: 'revert' })}
            ><Icon name="undo" size={13} stroke={2} />{t('proposal.revert')}</button
          >
        {/if}
      </div>
    {/if}
  </div>
{/if}
