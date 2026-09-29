<script lang="ts">
  import type { AgentModel } from '@skaro/timeline';
  import { AgentLogo, Icon, Modal, t, tn } from '@skaro/ui';
  import type {
    AgentInfo,
    AgentSettings,
    ChatSettings,
    ChatSummary,
    ImportSource,
  } from '../../../shared/ipc';
  import { modelName } from '../feed/format';
  import AgentModal from '../task/AgentModal.svelte';
  import { effortLabel } from '../tasks/agent-models.svelte';
  import './i18n';

  /**
   * "Импорт документации" (ImportModal mockup): folders, files and archives to import, what Skaro
   * reads of them, the agent that carries them over (architecture.md 12.1).
   */
  let {
    projectId,
    agents,
    onclose,
    onstart,
  }: {
    projectId: string;
    agents: AgentInfo[];
    onclose: () => void;
    onstart: (chat: ChatSummary) => void;
  } = $props();

  let open = $state(true);
  let sources = $state<ImportSource[]>([]);
  let hasCode = $state(false);
  let settings = $state.raw<ChatSettings | undefined>();
  let models = $state.raw<AgentModel[]>([]);
  let agentModal = $state(false);
  let over = $state(false);
  let busy = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (!open) onclose();
  });

  // svelte-ignore state_referenced_locally
  void window.skaro
    .invoke('project.hasCode', projectId)
    .then((v) => (hasCode = v))
    .catch(() => undefined);
  // svelte-ignore state_referenced_locally
  void window.skaro
    .invoke('chats.defaults', projectId)
    .then((s) => (settings = s))
    .catch(() => (settings = { agent: 'claude-code' }));

  $effect(() => {
    const agent = settings?.agent;
    if (!agent) return;
    void window.skaro
      .invoke('agents.models', agent, projectId)
      .then((list) => (models = list))
      .catch(() => (models = []));
  });

  const model = $derived(
    models.find((m) => m.id === settings?.model) ?? models.find((m) => m.isDefault),
  );
  const effort = $derived(
    settings?.effort ??
      model?.defaultEffort ??
      model?.efforts[Math.floor(model.efforts.length / 2)]?.id,
  );
  const missing = $derived(sources.filter((s) => s.missing));
  const read = $derived(sources.reduce((n, s) => n + (s.missing ? 0 : s.readable), 0));
  const unsupported = $derived(sources.reduce((n, s) => n + (s.missing ? 0 : s.unsupported), 0));
  const formats = $derived([...new Set(sources.flatMap((s) => s.formats))].sort());
  const ok = $derived(sources.length > 0 && read > 0 && !missing.length && !busy);
  const modalSettings = $derived<AgentSettings | undefined>(
    settings && {
      agent: settings.agent,
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
      permissionMode: settings.permissionMode ?? 'ask',
      planFirst: false,
      isolation: 'in-place',
    },
  );

  async function add(paths: string[]): Promise<void> {
    const fresh = paths.filter((p) => !sources.some((s) => s.path === p));
    if (!fresh.length) return;
    const found = await window.skaro.invoke('import.scan', fresh).catch(() => []);
    sources = [...sources, ...found];
  }

  async function pick(kind: 'folder' | 'files'): Promise<void> {
    const picked = await window.skaro.invoke('files.pick', kind).catch(() => []);
    await add(picked.map((p) => p.path));
  }

  function drop(e: DragEvent): void {
    e.preventDefault();
    over = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    void add(files.map((f) => window.skaro.pathOf(f)).filter(Boolean));
  }

  async function start(): Promise<void> {
    if (!ok || !settings) return;
    busy = true;
    error = undefined;
    try {
      const chat = await window.skaro.invoke(
        'import.start',
        projectId,
        sources.map((s) => s.path),
        settings,
      );
      onstart(chat);
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
    } finally {
      busy = false;
    }
  }

  function count(s: ImportSource): string {
    return s.missing ? t('import.missing') : tn('import.files', s.files);
  }
</script>

<Modal bind:open width={540} title={t('import.title')} subtitle={t('import.subtitle')}>
  <div class="body">
    {#if missing.length}
      <div class="alert" role="alert">
        <Icon name="errorCircle" size={16} stroke={1.9} />
        <span class="alert-text"
          ><strong>{t('import.missing.title')}</strong>
          {t('import.missing.text.before')}<span class="mono">{missing[0]!.display}</span>{t(
            'import.missing.text.after',
          )}</span
        >
      </div>
    {:else if error}
      <div class="alert" role="alert">
        <Icon name="errorCircle" size={16} stroke={1.9} />
        <span class="alert-text">{error}</span>
      </div>
    {/if}

    <div
      class="drop"
      class:over
      role="button"
      tabindex="0"
      onclick={() => void pick('folder')}
      onkeydown={(e) => e.key === 'Enter' && void pick('folder')}
      ondragover={(e) => {
        e.preventDefault();
        over = true;
      }}
      ondragleave={() => (over = false)}
      ondrop={drop}
    >
      <span class="drop-icon"><Icon name="import" size={22} stroke={1.7} /></span>
      <span class="drop-text">{t('import.drop')}</span>
      <div class="drop-actions">
        <button
          type="button"
          class="small"
          onclick={(e) => {
            e.stopPropagation();
            void pick('folder');
          }}>{t('import.pickFolder')}</button
        >
        <button
          type="button"
          class="small"
          onclick={(e) => {
            e.stopPropagation();
            void pick('files');
          }}>{t('import.pickFiles')}</button
        >
      </div>
    </div>

    {#if sources.length}
      <div class="sources">
        {#each sources as source (source.path)}
          <div
            class="source"
            class:broken={source.missing}
            data-tip={source.missing ? t('import.missing.tip') : undefined}
          >
            <span class="source-icon"
              ><Icon
                name={source.kind === 'folder'
                  ? 'folderSource'
                  : source.kind === 'archive'
                    ? 'archive'
                    : 'fileBlank'}
                size={15}
                stroke={1.8}
              /></span
            >
            <span class="source-path">{source.display}</span>
            <span class="source-count">{count(source)}</span>
            <button
              type="button"
              class="remove"
              data-tip={t('import.remove')}
              aria-label={t('import.remove')}
              onclick={() => (sources = sources.filter((s) => s.path !== source.path))}
              ><Icon name="close" size={12} stroke={2.2} /></button
            >
          </div>
        {/each}
      </div>
      {#if read > 0}
        <span class="note"
          >{t('import.read', { n: read })} ·
          <span class="formats" data-tip={t('import.formats', { list: formats.join(', ') })}
            >{t('import.unsupported', { n: unsupported })}</span
          ></span
        >
      {:else if !missing.length}
        <span class="note warn"
          >{t('import.nothing')} ·
          <span class="formats warn" data-tip={t('import.formats', { list: formats.join(', ') })}
            >{t('import.nothing.formats')}</span
          ></span
        >
      {/if}
    {/if}

    {#if hasCode}<span class="note">{t('import.code')}</span>{/if}

    <div class="agent">
      <span class="sk-label">{t('import.agent')}</span>
      {#if settings}
        <button
          type="button"
          class="agent-btn"
          data-tip={t('import.agent.tip')}
          onclick={() => (agentModal = true)}
        >
          <AgentLogo agent={settings.agent} size={15} />
          {modelName(settings.model, models)}
          {#if effort}<span class="effort">· {effortLabel(effort)}</span>{/if}
          <Icon name="chevronDown" size={11} stroke={2.4} />
        </button>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <button type="button" class="cancel" onclick={() => (open = false)}>{t('ui.cancel')}</button>
    <button
      type="button"
      class="start"
      class:ok
      disabled={!ok}
      data-tip={ok || busy
        ? undefined
        : sources.length
          ? t('import.start.unreadable')
          : t('import.start.empty')}
      onclick={() => void start()}>{t('import.start')}</button
    >
  {/snippet}
</Modal>

{#if modalSettings}
  <AgentModal
    bind:open={agentModal}
    kind="chat"
    {projectId}
    settings={modalSettings}
    {agents}
    locked={false}
    onsave={async (next) => {
      settings = {
        agent: next.agent,
        ...(next.model ? { model: next.model } : {}),
        ...(next.effort ? { effort: next.effort } : {}),
        ...(next.permissionMode === 'full' ? { permissionMode: 'full' as const } : {}),
      };
    }}
  />
{/if}

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 12px 11px 14px;
    border-radius: 9px;
    background: var(--sk-error-a10);
    color: var(--sk-error);
  }

  .alert-text {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
  }

  .alert-text strong {
    font-weight: 600;
  }

  .mono {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
  }

  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 20px 16px 16px;
    border-radius: 10px;
    background: var(--sk-fill-6);
    border: 1.5px dashed var(--sk-fill-31);
    text-align: center;
    cursor: pointer;
    outline: none;
  }

  .drop:hover,
  .drop.over {
    border-color: var(--sk-fill-36);
    background: var(--sk-fill-7);
  }

  .drop-icon {
    display: inline-flex;
    color: var(--sk-text-23);
  }

  .drop-text {
    font-size: var(--sk-fs-6);
    color: var(--sk-text-13);
  }

  .drop-actions {
    display: flex;
    gap: 8px;
  }

  .small {
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-23);
    color: var(--sk-text-6);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .small:hover {
    background: var(--sk-fill-28);
    color: var(--sk-text-2);
  }

  .sources {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .source {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 4px 6px 4px 10px;
    border-radius: 8px;
    background: var(--sk-fill-6);
  }

  .source-icon {
    flex: none;
    display: inline-flex;
    color: var(--sk-text-19);
  }

  .source-path {
    flex: 1;
    min-width: 0;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-count {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .source.broken .source-icon,
  .source.broken .source-path,
  .source.broken .source-count {
    color: var(--sk-error);
  }

  .remove {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-21);
    cursor: pointer;
  }

  .remove:hover {
    background: var(--sk-fill-20);
    color: var(--sk-text-2);
  }

  .note {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }

  .note.warn {
    color: var(--sk-warn);
  }

  .formats {
    border-bottom: 1px dotted var(--sk-text-27);
    cursor: default;
  }

  .formats.warn {
    border-bottom-color: #7a5d2b;
  }

  .agent {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 2px;
  }

  .agent-btn {
    flex: none;
    height: 30px;
    padding: 0 10px 0 9px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: none;
    border-radius: 999px;
    background: var(--sk-fill-20);
    color: var(--sk-text-10);
    font: inherit;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .agent-btn:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .effort {
    color: var(--sk-text-23);
    font-weight: 400;
  }

  .cancel,
  .start {
    height: 34px;
    border: none;
    border-radius: 8px;
    font: inherit;
    font-size: var(--sk-fs-6);
  }

  .cancel {
    padding: 0 14px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .start {
    padding: 0 15px;
    background: var(--sk-fill-20);
    color: var(--sk-text-25);
    font-weight: 700;
    cursor: default;
  }

  .start.ok {
    background: var(--sk-accent);
    color: var(--sk-text-1);
    cursor: pointer;
  }

  .start.ok:hover {
    background: var(--sk-accent-hover);
  }
</style>
