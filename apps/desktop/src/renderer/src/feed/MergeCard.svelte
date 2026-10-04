<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';
  import type { MergeAction } from '../../../shared/ipc';
  import { useFeed } from './context.svelte';
  import MergeStageTasks from './MergeStageTasks.svelte';
  import './merge-card.css';

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
  /** A stage merge has a message for the commit of each task instead of one for all. */
  const stage = $derived(interaction.stage);
  let messages = $state<Record<string, string>>({});

  $effect(() => {
    if (!edited) message = defaultMessage;
  });

  const blocked = $derived(interaction.blockers.length > 0);
  const conflicts = $derived(interaction.blockers.includes('conflicts'));
  const localChanges = $derived(interaction.localChanges ?? []);

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

<div class="fd-card fd-merge-card">
  <span class="fd-card-title"
    >{t(
      stage
        ? stage.partial
          ? 'card.merge.stage.partialTitle'
          : 'card.merge.stage.title'
        : 'card.merge.title',
    )}</span
  >
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

  {#if stage}
    <MergeStageTasks {stage} editable={!blocked} bind:messages />
  {/if}
  {#each interaction.blockers as blocker (blocker)}
    <div class="line bad">
      <Icon name="error" size={12} stroke={2} />
      <span>{t(`card.merge.blocker.${blocker}`, { to: interaction.to })}</span>
    </div>
    {#if blocker === 'criteria' && stage}
      <div class="files plain">
        {#each stage.unmet as criterion (criterion)}<span>{criterion}</span>{/each}
      </div>
    {/if}
  {/each}
  {#if localChanges.length}
    <div class="files">
      {#each localChanges as file (file)}<span>{file}</span>{/each}
    </div>
  {/if}
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

  {#if stage?.partial}
    <div class="line warn">
      <Icon name="warning" size={12} stroke={2} />
      <span>{t('card.merge.stage.noAcceptance')}</span>
    </div>
  {/if}

  {#if !blocked && !stage}
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
        data-tip={t(stage ? 'card.merge.stage.updateTip' : 'card.merge.updateTip')}
        disabled={!!busy}
        onclick={() => void act({ action: 'update_branch' })}
        >{t(stage ? 'card.merge.stage.update' : 'card.merge.update')}</button
      >
    {/if}
    {#if conflicts}
      <button
        type="button"
        class="fd-btn primary"
        data-tip={t(stage ? 'card.merge.stage.resolveTip' : 'card.merge.resolveTip')}
        disabled={!!busy}
        onclick={() => void act({ action: 'resolve_with_agent' })}>{t('card.merge.resolve')}</button
      >
    {:else}
      <button
        type="button"
        class="fd-btn primary"
        data-tip={stage ? undefined : t('card.merge.confirmTip')}
        disabled={blocked || !!busy || (!stage && !message.trim())}
        onclick={() =>
          void act({
            action: 'confirm',
            message: message.trim(),
            ...(stage ? { messages: $state.snapshot(messages) } : {}),
          })}>{busy === 'confirm' ? t('card.merge.working') : t('card.merge.confirm')}</button
      >
    {/if}
  </div>
</div>
