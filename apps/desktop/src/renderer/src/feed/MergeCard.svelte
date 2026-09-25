<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';
  import type { MergeAction } from '../../../shared/ipc';
  import { useFeed } from './context.svelte';

  /**
   * Merge confirmation in the task chat (D-27, architecture.md 8): what goes where, checks that
   * block, warnings, the commit message. Skaro merges only after "Влить".
   */
  let {
    interaction,
    defaultMessage,
  }: { interaction: Extract<Interaction, { kind: 'merge' }>; defaultMessage: string } = $props();

  const feed = useFeed();
  let message = $state('');
  let edited = $state(false);
  let busy = $state<MergeAction['action'] | undefined>();
  let error = $state<string | undefined>();

  $effect(() => {
    if (!edited) message = defaultMessage;
  });

  const blocked = $derived(interaction.blockers.length > 0);
  const conflicts = $derived(interaction.blockers.includes('conflicts'));

  async function act(action: MergeAction): Promise<void> {
    if (busy) return;
    busy = action.action;
    error = undefined;
    try {
      await feed.merge(interaction.id, action);
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e);
    } finally {
      busy = undefined;
    }
  }
</script>

<div class="fd-card">
  <span class="fd-card-title">{t('card.merge.title')}</span>
  <div class="route">
    <Icon name="branch" size={12} stroke={1.9} />
    <span class="branch">{interaction.from}</span>
    <span class="arrow">→</span>
    <span class="base">{interaction.to}</span>
  </div>
  <div class="stats">
    {tn('feed.files', interaction.files)} · <span class="fd-plus">+{interaction.added}</span>
    <span class="fd-minus">−{interaction.removed}</span>
  </div>

  {#each interaction.blockers as blocker (blocker)}
    <div class="line bad">
      <Icon name="error" size={12} stroke={2} />
      <span>{t(`card.merge.blocker.${blocker}`, { to: interaction.to })}</span>
    </div>
  {/each}
  {#if conflicts && interaction.conflicts.length}
    <div class="files">
      {#each interaction.conflicts as file (file)}<span>{file}</span>{/each}
    </div>
  {/if}
  {#if interaction.baseAhead > 0}
    <div class="line warn">
      <Icon name="warning" size={12} stroke={2} />
      <span>{tn('card.merge.baseAhead', interaction.baseAhead, { to: interaction.to })}</span>
    </div>
  {/if}
  {#if interaction.skaroChanges.length}
    <div class="line warn" data-tip={interaction.skaroChanges.join('\n')}>
      <Icon name="warning" size={12} stroke={2} />
      <span>{t('card.merge.skaro')}</span>
    </div>
  {/if}

  {#if !blocked}
    <label class="message">
      <span class="fd-label">{t('card.merge.message')}</span>
      <textarea class="fd-input" rows="3" bind:value={message} oninput={() => (edited = true)}
      ></textarea>
    </label>
  {/if}

  {#if error}<div class="line bad">
      <Icon name="error" size={12} stroke={2} /><span>{error}</span>
    </div>{/if}

  <div class="fd-card-actions">
    <button
      type="button"
      class="fd-btn"
      disabled={!!busy}
      onclick={() => void act({ action: 'cancel' })}>{t('card.merge.cancel')}</button
    >
    {#if interaction.baseAhead > 0 && !conflicts}
      <button
        type="button"
        class="fd-btn"
        data-tip={t('card.merge.updateTip')}
        disabled={!!busy}
        onclick={() => void act({ action: 'update_branch' })}>{t('card.merge.update')}</button
      >
    {/if}
    {#if conflicts}
      <button
        type="button"
        class="fd-btn primary"
        data-tip={t('card.merge.resolveTip')}
        disabled={!!busy}
        onclick={() => void act({ action: 'resolve_with_agent' })}>{t('card.merge.resolve')}</button
      >
    {:else}
      <button
        type="button"
        class="fd-btn primary"
        data-tip={t('card.merge.confirmTip')}
        disabled={blocked || !!busy || !message.trim()}
        onclick={() => void act({ action: 'confirm', message: message.trim() })}
        >{busy === 'confirm' ? t('card.merge.working') : t('card.merge.confirm')}</button
      >
    {/if}
  </div>
</div>

<style>
  .route {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #e8875b;
    min-width: 0;
  }

  .branch {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .arrow {
    flex: none;
    color: #6f6f6f;
  }

  .base {
    flex: none;
    color: #c8c8c8;
  }

  .stats {
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #8a8a8a;
    display: flex;
    gap: 6px;
  }

  .line {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 12px;
    line-height: 1.45;
  }

  .line :global(svg) {
    margin-top: 2px;
  }

  .line.bad {
    color: #ef6a63;
  }

  .line.warn {
    color: #e0a33c;
  }

  .files {
    margin-left: 19px;
    display: flex;
    flex-direction: column;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #a6a6a6;
  }

  .message {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  textarea.fd-input {
    height: auto;
    padding: 8px 11px;
    line-height: 1.5;
    resize: vertical;
  }
</style>
