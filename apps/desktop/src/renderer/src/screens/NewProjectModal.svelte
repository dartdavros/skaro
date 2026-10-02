<script lang="ts">
  import { Button, Modal, t } from '@skaro/ui';
  import NewProjectModes from './NewProjectModes.svelte';
  import NewProjectFolder from './NewProjectFolder.svelte';
  import type { NewProjectProps } from './new-project-props';
  import { createNewProjectController } from './new-project-controller.svelte';
  let { open = $bindable(false), oncreated }: NewProjectProps = $props();
  const state = createNewProjectController({
    get open() {
      return open;
    },
    get oncreated() {
      return oncreated;
    },
    set open(value: boolean) {
      open = value;
    },
  });

  import './new-project-modal.css';
</script>

<Modal
  bind:open
  title={t('newProject.title')}
  subtitle={t('newProject.subtitle')}
  width={468}
  closable={false}
>
  <div data-new-project-modal class="body">
    <NewProjectModes {state} />

    <NewProjectFolder {state} />
  </div>
  {#snippet footer()}
    <span data-new-project-modal class="note">{t('newProject.note')}</span>
    <Button onclick={() => (open = false)}>{t('ui.cancel')}</Button>
    <Button
      variant="primary"
      disabled={!state.ready || state.busy}
      onclick={() => void state.submit()}
    >
      {state.mode === 'create' ? t('newProject.createAction') : t('newProject.connect')}
    </Button>
  {/snippet}
</Modal>
