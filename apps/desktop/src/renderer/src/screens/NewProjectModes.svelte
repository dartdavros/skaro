<script lang="ts">
  import { t } from '@skaro/ui';
  import type { NewProjectController } from './new-project-controller.svelte';
  let { state }: { state: NewProjectController } = $props();
</script>

<div data-new-project-modal class="modes">
  <button
    data-new-project-modal
    type="button"
    class="mode"
    class:on={state.mode === 'existing'}
    onclick={() => (state.mode = 'existing')}
  >
    <span data-new-project-modal class="icon">
      <svg
        data-new-project-modal
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path data-new-project-modal d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v2"></path><path
          data-new-project-modal
          d="M3.5 19 6 10h15l-2.4 9Z"
        ></path></svg
      >
    </span>
    <span data-new-project-modal class="mode-title">{t('newProject.existing')}</span>
    <span data-new-project-modal class="mode-note">{t('newProject.existing.note')}</span>
  </button>
  <button
    data-new-project-modal
    type="button"
    class="mode"
    class:on={state.mode === 'create'}
    onclick={() => (state.mode = 'create')}
  >
    <span data-new-project-modal class="icon">
      <svg
        data-new-project-modal
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path
          data-new-project-modal
          d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"
        ></path><path data-new-project-modal d="M12 11v6M9 14h6"></path></svg
      >
    </span>
    <span data-new-project-modal class="mode-title">{t('newProject.create')}</span>
    <span data-new-project-modal class="mode-note">{t('newProject.create.note')}</span>
  </button>
</div>
