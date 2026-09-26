<script lang="ts">
  import { Select, t } from '@skaro/ui';
  import type { ExternalApp } from '../../../shared/ipc';
  import Card from './Card.svelte';
  import { Setting } from './setting.svelte';

  /** "Проекты": where new projects go, the editor and terminal to open them in. */
  let folder = $state('');
  const editor = new Setting<ExternalApp>('apps.editor', { kind: 'vscode' });
  const terminal = new Setting<ExternalApp>('apps.terminal', { kind: 'system' });
  const mac = window.skaro.platform === 'darwin';

  $effect(() => {
    void window.skaro.invoke('projects.defaultParent').then((p) => (folder = p));
  });

  async function pickFolder(): Promise<void> {
    const picked = await window.skaro.invoke('projects.pickFolder', folder);
    if (!picked) return;
    folder = picked;
    void window.skaro.invoke('app.setSetting', 'projects.parent', picked);
  }

  const name = (path: string) => path.split(/[\\/]/).pop() ?? path;

  function options(list: [string, string][], current: ExternalApp) {
    return [
      ...list.map(([value, label], i) => ({
        value,
        label,
        ...(i === 0 ? { tag: t('settings.app.default') } : {}),
      })),
      {
        value: 'custom',
        label: current.kind === 'custom' ? name(current.path) : t('settings.app.other'),
        ...(current.kind === 'custom' ? { description: current.path } : {}),
      },
    ];
  }

  async function choose(setting: Setting<ExternalApp>, value: string): Promise<void> {
    if (value !== 'custom') return setting.set({ kind: value } as ExternalApp);
    const path = await window.skaro.invoke('app.pickApp');
    if (path) setting.set({ kind: 'custom', path });
  }

  const editors = $derived(
    options(
      [
        ['vscode', 'VS Code'],
        ['cursor', 'Cursor'],
        ['jetbrains', 'JetBrains'],
      ],
      editor.value,
    ),
  );
  const terminals = $derived(
    options(
      [
        ['system', t('settings.app.system')],
        ...(mac ? ([['iterm2', 'iTerm2']] as [string, string][]) : []),
        ['warp', 'Warp'],
      ],
      terminal.value,
    ),
  );
</script>

<Card label={t('settings.projects')}>
  <div class="grid">
    <span class="key">{t('settings.projects.folder')}</span>
    <div class="folder">
      <div class="path">{folder}</div>
      <button type="button" class="pick" onclick={pickFolder}>{t('settings.projects.pick')}</button>
    </div>
    <span class="key">{t('settings.projects.editor')}</span>
    <Select
      width={280}
      menuWidth="100%"
      label={t('settings.projects.editor')}
      options={editors}
      bind:value={() => editor.value.kind, (v) => void choose(editor, v)}
    />
    <span class="key">{t('settings.projects.terminal')}</span>
    <Select
      width={280}
      menuWidth="100%"
      label={t('settings.projects.terminal')}
      options={terminals}
      bind:value={() => terminal.value.kind, (v) => void choose(terminal, v)}
    />
  </div>
</Card>

<style>
  .folder {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .path {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 11px;
    display: flex;
    align-items: center;
    border-radius: 8px;
    background: var(--sk-fill-3);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    color: var(--sk-text-7);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pick {
    flex: none;
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-23);
    color: var(--sk-text-6);
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .pick:hover {
    background: var(--sk-fill-28);
    color: var(--sk-text-2);
  }
</style>
