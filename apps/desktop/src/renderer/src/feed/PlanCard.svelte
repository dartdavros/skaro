<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import Markdown from './Markdown.svelte';

  /** "План агента" in plan-first mode: approve, or send it back with a note (mockup 9h). */
  let { interaction }: { interaction: Extract<Interaction, { kind: 'plan_approval' }> } = $props();

  const feed = useFeed();
  let full = $state(false);
  let rework = $state(false);
  let note = $state('');
  let sending = $state(false);

  const long = $derived(interaction.plan.split('\n').length > 8 || interaction.plan.length > 700);
  const shown = $derived(
    full || !long ? interaction.plan : interaction.plan.split('\n').slice(0, 8).join('\n'),
  );

  async function answer(approve: boolean, message?: string): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      await feed.respond(interaction.id, {
        kind: 'plan_approval',
        approve,
        ...(message ? { message } : {}),
      });
    } finally {
      sending = false;
    }
  }
</script>

<div class="fd-card">
  <span class="fd-label">{t('card.plan.title')}</span>
  <div class="plan fd-text"><Markdown text={shown} /></div>
  {#if long}
    <button type="button" class="fd-link-btn" onclick={() => (full = !full)}
      >{full ? t('card.plan.less') : t('card.plan.more')}</button
    >
  {/if}
  {#if rework}
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="fd-input"
        placeholder={t('card.plan.reworkPlaceholder')}
        bind:value={note}
        autofocus
        onkeydown={(e) => e.key === 'Enter' && note.trim() && void answer(false, note.trim())}
      />
      <button type="button" class="fd-btn ghost" onclick={() => (rework = false)}
        >{t('card.perm.cancel')}</button
      >
      <button
        type="button"
        class="fd-btn"
        disabled={!note.trim() || sending}
        onclick={() => void answer(false, note.trim())}>{t('card.perm.send')}</button
      >
    </div>
  {:else}
    <div class="fd-card-actions">
      <button type="button" class="fd-btn" onclick={() => (rework = true)}
        >{t('card.plan.rework')}</button
      >
      <button
        type="button"
        class="fd-btn primary"
        disabled={sending}
        onclick={() => void answer(true)}>{t('card.plan.approve')}</button
      >
    </div>
  {/if}
</div>

<style>
  .plan {
    font-size: 12.5px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
