<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { NewProjectController } from './new-project-controller.svelte';
  let { state }: { state: NewProjectController } = $props();
</script>

<div data-new-project-modal class="field">
  <span data-new-project-modal class="sk-label"
    >{state.mode === 'create' ? t('newProject.where') : t('newProject.folder')}</span
  >
  <div data-new-project-modal class="path-row">
    <div
      data-new-project-modal
      class="path"
      class:placeholder={state.mode === 'existing' && !state.folder}
    >
      {state.mode === 'create' ? state.parent : (state.folder?.path ?? t('newProject.pick'))}
    </div>
    <button
      data-new-project-modal
      type="button"
      class="browse"
      data-tip={t('newProject.browse.tip')}
      onclick={() => void state.browse()}
    >
      {t('newProject.browse')}
    </button>
  </div>
</div>

{#if state.mode === 'create'}
  <label data-new-project-modal class="field">
    <span data-new-project-modal class="sk-label">{t('newProject.name')}</span>
    <input
      data-new-project-modal
      class="name"
      type="text"
      placeholder="shop-api"
      bind:value={state.name}
      onkeydown={(e) => e.key === 'Enter' && void state.submit()}
    />
    <span data-new-project-modal class="hint">{t('newProject.create.hint')}</span>
  </label>
{:else if state.folder?.exists && state.folder.git}
  <div data-new-project-modal class="info">
    <Icon name="branch" size={14} stroke={1.9} color="var(--sk-text-15)" />
    <span data-new-project-modal
      >{state.folder.branch
        ? t('newProject.git', { branch: state.folder.branch })
        : t('newProject.gitNoBranch')}</span
    >
  </div>
{:else if state.folder?.exists}
  <div data-new-project-modal class="info warn">
    <Icon name="warning" size={14} stroke={1.9} />
    <span data-new-project-modal>{t('newProject.noGit')}</span>
  </div>
{:else if state.folder}
  <div data-new-project-modal class="info warn">
    <Icon name="warning" size={14} stroke={1.9} />
    <span data-new-project-modal>{t('newProject.missing')}</span>
  </div>
{/if}

{#if state.error}
  <div data-new-project-modal class="info error">
    <Icon name="error" size={14} stroke={1.9} /><span data-new-project-modal>{state.error}</span>
  </div>
{/if}
