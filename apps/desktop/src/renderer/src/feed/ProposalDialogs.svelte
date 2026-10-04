<script lang="ts">
  import { Button, Modal, TextField, t } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  import Markdown from './Markdown.svelte';
  let { state }: { state: ProposalState } = $props();
  const proposal = $derived(state.proposal);
</script>

{#if proposal.type === 'doc' || proposal.type === 'task' || proposal.type === 'spec_change'}
  <Modal
    bind:open={state.viewer}
    width={760}
    title={proposal.type === 'doc'
      ? proposal.path
      : proposal.type === 'spec_change'
        ? `SPEC-${proposal.id} · ${proposal.title}`
        : `${proposal.id} · ${proposal.title}`}
    subtitle={t('proposal.viewer.subtitle')}
  >
    <div class="viewer"><Markdown text={proposal.after} /></div>
  </Modal>
{/if}

{#if proposal.type === 'adr' || proposal.type === 'spec'}
  <Modal
    bind:open={state.editing}
    width={640}
    title={proposal.type === 'spec' ? t('proposal.spec.view') : t('proposal.adr.view')}
    subtitle={t('proposal.adr.edit.subtitle')}
  >
    <div class="edit">
      <TextField label={t('proposal.adr.title')} bind:value={state.adrTitle} />
      <label class="edit-body">
        <span class="sk-label">{t('proposal.adr.body')}</span>
        <textarea bind:value={state.adrBody} rows="14"></textarea>
      </label>
    </div>
    {#snippet footer()}
      <Button onclick={() => (state.editing = false)}>{t('proposal.cancel')}</Button>
      <Button
        variant="primary"
        disabled={state.busy || !state.adrTitle.trim() || !state.adrBody.trim()}
        onclick={() => {
          state.editing = false;
          void state.decide({
            action: 'apply',
            adr: { title: state.adrTitle.trim(), body: state.adrBody },
          });
        }}>{t('proposal.accept')}</Button
      >
    {/snippet}
  </Modal>
{/if}

<style>
  .viewer {
    max-height: calc(100vh - 220px);
    overflow-y: auto;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .edit {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .edit-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  textarea {
    width: 100%;
    min-height: 240px;
    max-height: calc(100vh - 360px);
    padding: 9px 11px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
    color: var(--sk-text-2);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    font-weight: 400;
    line-height: 1.45;
    resize: vertical;
    outline: none;
  }

  textarea:focus {
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }
</style>
