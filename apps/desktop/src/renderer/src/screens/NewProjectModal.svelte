<script lang="ts">
  import { Button, Icon, Modal, t } from '@skaro/ui';
  import type { FolderInfo, ProjectInfo } from '../../../shared/ipc';

  /** "Новый проект" (Projects mockup): connect an existing folder or create an empty one. */
  let {
    open = $bindable(false),
    oncreated,
  }: { open?: boolean; oncreated: (project: ProjectInfo) => void } = $props();

  let mode = $state<'existing' | 'create'>('existing');
  let folder = $state<FolderInfo | undefined>();
  let parent = $state('');
  let name = $state('');
  let busy = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (!open) return;
    mode = 'existing';
    folder = undefined;
    name = '';
    error = undefined;
    void window.skaro.invoke('projects.defaultParent').then((p) => (parent = p));
  });

  const ready = $derived(
    mode === 'existing' ? folder?.exists === true : parent !== '' && name.trim() !== '',
  );

  async function browse(): Promise<void> {
    error = undefined;
    const picked = await window.skaro.invoke(
      'projects.pickFolder',
      mode === 'create' ? parent : (folder?.path ?? parent),
    );
    if (!picked) return;
    if (mode === 'create') parent = picked;
    else folder = await window.skaro.invoke('projects.inspect', picked);
  }

  async function submit(): Promise<void> {
    if (!ready || busy) return;
    busy = true;
    error = undefined;
    try {
      const project =
        mode === 'existing'
          ? await window.skaro.invoke('projects.add', folder!.path)
          : await window.skaro.invoke('projects.create', parent, name.trim());
      open = false;
      oncreated(project);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      error = text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={t('newProject.title')} subtitle={t('newProject.subtitle')} width={468}>
  <div class="body">
    <div class="modes">
      <button
        type="button"
        class="mode"
        class:on={mode === 'existing'}
        onclick={() => (mode = 'existing')}
      >
        <span class="icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v2"></path><path
              d="M3.5 19 6 10h15l-2.4 9Z"
            ></path></svg
          >
        </span>
        <span class="mode-title">{t('newProject.existing')}</span>
        <span class="mode-note">{t('newProject.existing.note')}</span>
      </button>
      <button
        type="button"
        class="mode"
        class:on={mode === 'create'}
        onclick={() => (mode = 'create')}
      >
        <span class="icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"
            ></path><path d="M12 11v6M9 14h6"></path></svg
          >
        </span>
        <span class="mode-title">{t('newProject.create')}</span>
        <span class="mode-note">{t('newProject.create.note')}</span>
      </button>
    </div>

    <div class="field">
      <span class="sk-label"
        >{mode === 'create' ? t('newProject.where') : t('newProject.folder')}</span
      >
      <div class="path-row">
        <div class="path" class:placeholder={mode === 'existing' && !folder}>
          {mode === 'create' ? parent : (folder?.path ?? t('newProject.pick'))}
        </div>
        <button
          type="button"
          class="browse"
          data-tip={t('newProject.browse.tip')}
          onclick={() => void browse()}
        >
          {t('newProject.browse')}
        </button>
      </div>
    </div>

    {#if mode === 'create'}
      <label class="field">
        <span class="sk-label">{t('newProject.name')}</span>
        <input
          class="name"
          type="text"
          placeholder="shop-api"
          bind:value={name}
          onkeydown={(e) => e.key === 'Enter' && void submit()}
        />
        <span class="hint">{t('newProject.create.hint')}</span>
      </label>
    {:else if folder?.exists && folder.git}
      <div class="info">
        <Icon name="branch" size={14} stroke={1.9} color="#a6a6a6" />
        <span
          >{folder.branch
            ? t('newProject.git', { branch: folder.branch })
            : t('newProject.gitNoBranch')}</span
        >
      </div>
    {:else if folder?.exists}
      <div class="info warn">
        <Icon name="warning" size={14} stroke={1.9} />
        <span>{t('newProject.noGit')}</span>
      </div>
    {:else if folder}
      <div class="info warn">
        <Icon name="warning" size={14} stroke={1.9} />
        <span>{t('newProject.missing')}</span>
      </div>
    {/if}

    {#if error}
      <div class="info error"><Icon name="error" size={14} stroke={1.9} /><span>{error}</span></div>
    {/if}
  </div>
  {#snippet footer()}
    <span class="note">{t('newProject.note')}</span>
    <Button onclick={() => (open = false)}>{t('ui.cancel')}</Button>
    <Button variant="primary" disabled={!ready || busy} onclick={() => void submit()}>
      {mode === 'create' ? t('newProject.createAction') : t('newProject.connect')}
    </Button>
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modes {
    display: flex;
    gap: 9px;
  }

  .mode {
    flex: 1;
    padding: 13px 14px;
    border: none;
    border-radius: 10px;
    background: #1a1a1a;
    display: flex;
    flex-direction: column;
    gap: 7px;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .mode:hover {
    background: #1e1e1e;
  }

  .mode.on {
    background: #242424;
  }

  .icon {
    display: inline-flex;
    color: #8a8a8a;
  }

  .mode.on .icon {
    color: #2a52be;
  }

  .mode-title {
    font-size: 13px;
    font-weight: 600;
    color: #d5d5d5;
  }

  .mode-note {
    font-size: 11.5px;
    line-height: 1.45;
    color: #8a8a8a;
    text-wrap: pretty;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .path-row {
    display: flex;
    gap: 8px;
  }

  .path {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 34px;
    padding: 0 11px;
    border-radius: 8px;
    background: #0f0f0f;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #b1b1b1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path.placeholder {
    font-family: var(--sk-font);
    color: #6f6f6f;
  }

  .browse {
    flex: none;
    height: 34px;
    padding: 0 13px;
    border: none;
    border-radius: 8px;
    background: #272727;
    color: #d5d5d5;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .browse:hover {
    background: #303030;
  }

  .name {
    height: 34px;
    padding: 0 11px;
    border: none;
    border-radius: 8px;
    background: #0f0f0f;
    color: #d5d5d5;
    font: inherit;
    font-size: 13px;
    outline: none;
    box-shadow: inset 0 0 0 1px #2a2a2a;
  }

  .name:hover {
    background: #0b0b0b;
    box-shadow: inset 0 0 0 1px #363636;
  }

  .name:focus {
    background: #0b0b0b;
    box-shadow: inset 0 0 0 1px #2a52be;
  }

  .hint {
    font-size: 11.5px;
    color: #7d7d7d;
  }

  .info {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    border-radius: 9px;
    background: #0f0f0f;
    font-size: 12px;
    color: #a6a6a6;
  }

  .info.warn {
    color: #e0a33c;
  }

  .info.error {
    color: #ef6a63;
  }

  .note {
    flex: 1;
    font-size: 11.5px;
    color: #7d7d7d;
    text-wrap: pretty;
  }
</style>
