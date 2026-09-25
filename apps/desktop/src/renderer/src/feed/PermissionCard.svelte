<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { displayPath } from './format';

  /**
   * Permission request (PermCard mockup): what, why, "Запретить" with an optional reason,
   * "Разрешить до конца задачи", "Разрешить". Only the first card of a stack has the blue button.
   */
  let {
    interaction,
    primary = true,
  }: { interaction: Extract<Interaction, { kind: 'approval' }>; primary?: boolean } = $props();

  const feed = useFeed();
  let denying = $state(false);
  let reason = $state('');
  let sending = $state(false);

  const action = $derived(interaction.action);
  const title = $derived(
    action.type === 'command'
      ? t('card.perm.command')
      : action.type === 'file_write'
        ? t('card.perm.file')
        : action.type === 'network'
          ? t('card.perm.network')
          : action.type === 'mcp'
            ? t('card.perm.mcp')
            : t('card.perm.other'),
  );
  const paths = $derived(
    (action.paths ?? []).map((p) => ({ raw: p, shown: displayPath(p, feed.cwd) })),
  );
  const what = $derived(action.command ?? action.host ?? (paths.length ? '' : action.title));

  async function answer(
    choice: 'allow_once' | 'allow_session' | 'deny',
    message?: string,
  ): Promise<void> {
    if (sending) return;
    sending = true;
    try {
      await feed.respond(
        interaction.id,
        choice === 'deny'
          ? { kind: 'approval', choice, ...(message ? { message } : {}) }
          : { kind: 'approval', choice },
      );
    } finally {
      sending = false;
    }
  }
</script>

<div class="fd-card">
  <div class="body">
    <span class="fd-card-title">{title}</span>
    {#if action.command}
      <code class="cmd">{action.command}</code>
    {:else if paths.length}
      {#each paths as path (path.raw)}
        <button
          type="button"
          class="path"
          data-tip={t('feed.openFile')}
          onclick={() => feed.openPath(path.raw)}>{path.shown}</button
        >
      {/each}
    {:else if what}
      <span class="host">{what}</span>
    {/if}
    {#if action.reason}<span class="fd-card-text">{action.reason}</span>{/if}
  </div>
  {#if denying}
    <div class="deny">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="fd-input"
        placeholder={t('card.perm.reason')}
        bind:value={reason}
        autofocus
        onkeydown={(e) => e.key === 'Enter' && void answer('deny', reason.trim())}
      />
      <button type="button" class="fd-btn ghost" onclick={() => (denying = false)}
        >{t('card.perm.cancel')}</button
      >
      <button
        type="button"
        class="fd-btn"
        data-tip={t('card.perm.reasonTip')}
        disabled={sending}
        onclick={() => void answer('deny', reason.trim())}>{t('card.perm.send')}</button
      >
    </div>
  {:else}
    <div class="fd-card-actions">
      <button
        type="button"
        class="fd-btn"
        data-tip={t('card.perm.denyTip')}
        onclick={() => (denying = true)}>{t('card.perm.deny')}</button
      >
      {#if interaction.choices.includes('allow_session')}
        <button
          type="button"
          class="fd-btn"
          data-tip={t('card.perm.alwaysTip')}
          disabled={sending}
          onclick={() => void answer('allow_session')}>{t('card.perm.always')}</button
        >
      {/if}
      <button
        type="button"
        class="fd-btn"
        class:primary
        data-tip={t('card.perm.allowTip')}
        disabled={sending}
        onclick={() => void answer('allow_once')}>{t('card.perm.allow')}</button
      >
    </div>
  {/if}
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .cmd {
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #e8875b;
    word-break: break-all;
    white-space: pre-wrap;
  }

  .path {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #7d9ce8;
    cursor: pointer;
    word-break: break-all;
    text-align: left;
  }

  .path:hover {
    text-decoration: underline;
  }

  .host {
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #c8c8c8;
    word-break: break-all;
  }

  .deny {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
