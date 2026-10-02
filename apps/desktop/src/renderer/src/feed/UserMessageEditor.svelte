<script lang="ts">
  import { t } from '@skaro/ui';
  import type { UserMessageController } from './user-message-controller.svelte';
  let { state }: { state: UserMessageController } = $props();
</script>

<div data-user-message class="fd-bubble editing">
  <!-- svelte-ignore a11y_autofocus -->
  <textarea
    data-user-message
    bind:value={state.draft}
    rows="2"
    autofocus
    onkeydown={(e) => e.key === 'Escape' && (state.editing = false)}></textarea>
  <div data-user-message class="edit-actions">
    <button data-user-message type="button" class="cancel" onclick={() => (state.editing = false)}
      >{t('feed.msg.cancel')}</button
    >
    <button
      data-user-message
      type="button"
      class="fd-btn primary"
      disabled={!state.draft.trim()}
      onclick={() => (state.confirm = 'edit')}>{t('feed.msg.send')}</button
    >
  </div>
</div>
