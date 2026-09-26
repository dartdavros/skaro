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

<Modal
  bind:open
  title={t('newProject.title')}
  subtitle={t('newProject.subtitle')}
  width={468}
  closable={false}
>
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
        <Icon name="branch" size={14} stroke={1.9} color="var(--sk-text-15)" />
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
    background: var(--sk-fill-11);
    display: flex;
    flex-direction: column;
    gap: 7px;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .mode:hover {
    background: var(--sk-fill-15);
  }

  .mode.on {
    background: var(--sk-fill-20);
  }

  .icon {
    display: inline-flex;
    color: var(--sk-text-19);
  }

  .mode.on .icon {
    color: var(--sk-accent);
  }

  .mode-title {
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-6);
  }

  .mode-note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-19);
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
    background: var(--sk-fill-3);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-10);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path.placeholder {
    font-family: var(--sk-font);
    color: var(--sk-text-23);
  }

  .browse {
    flex: none;
    height: 34px;
    padding: 0 13px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-23);
    color: var(--sk-text-6);
    font: inherit;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .browse:hover {
    background: var(--sk-fill-29);
  }

  .name {
    height: 34px;
    padding: 0 11px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    color: var(--sk-text-6);
    font: inherit;
    font-size: var(--sk-fs-6);
    outline: none;
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
  }

  .name:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-31);
  }

  .name:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .hint {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .info {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px;
    border-radius: 9px;
    background: var(--sk-fill-3);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-13);
  }

  .info.warn {
    color: var(--sk-warn);
  }

  .info.error {
    color: var(--sk-error);
  }

  .note {
    flex: 1;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
    text-wrap: pretty;
  }
</style>
