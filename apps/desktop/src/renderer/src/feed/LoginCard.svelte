<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';

  /** An MCP server asks to sign in (mockup 9f). */
  let { interaction }: { interaction: Extract<Interaction, { kind: 'login' }> } = $props();

  const feed = useFeed();
  let sending = $state(false);
  /** Sign-in opened in the browser; the user confirms when it is done. */
  let opened = $state(false);

  async function answer(action: 'done' | 'cancel'): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      await feed.respond(interaction.id, { kind: 'login', action });
    } finally {
      sending = false;
    }
  }
</script>

<div class="fd-card">
  <span class="fd-card-title">{t('card.login.title', { server: interaction.server })}</span>
  <span class="fd-card-text">{t('card.login.text', { server: interaction.server })}</span>
  <div class="fd-card-actions">
    <button type="button" class="fd-btn" disabled={sending} onclick={() => void answer('cancel')}
      >{t('card.login.skip')}</button
    >
    {#if opened}
      <button
        type="button"
        class="fd-btn primary"
        disabled={sending}
        onclick={() => void answer('done')}>{t('card.login.done')}</button
      >
    {:else}
      <button
        type="button"
        class="fd-btn primary"
        onclick={() => {
          feed.openExternal(interaction.url);
          opened = true;
        }}>{t('card.login.go')}</button
      >
    {/if}
  </div>
</div>
