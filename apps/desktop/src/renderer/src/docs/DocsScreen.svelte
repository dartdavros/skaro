<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import '../feed/i18n';
  import type { ProjectTasks } from '../tasks/data.svelte';
  import { ProjectDocs } from './data.svelte';
  import DocEditor from './DocEditor.svelte';
  import DocHeader from './DocHeader.svelte';
  import DocPage from './DocPage.svelte';
  import DocTree from './DocTree.svelte';
  import './i18n';
  import LeaveModal from './LeaveModal.svelte';
  import { adrLink, BRIEF, specLink, titleOf } from './model';
  import NewDocModal from './NewDocModal.svelte';
  import NewSpecModal from './NewSpecModal.svelte';
  import { renderDoc } from './render';

  /** "Документы" (Documents mockup): the tree, a document to read or edit. */
  let {
    projectId,
    open,
    tasks,
    onchat,
    ontask,
    onimport,
  }: {
    projectId: string;
    /** A document to show first: a task's specification. */
    open?: string | undefined;
    /** The project's tasks, for the "Задачи" block of a specification. */
    tasks: ProjectTasks;
    onchat: () => void;
    ontask: (id: string) => void;
    /** "Импортировать документацию". */
    onimport: () => void;
  } = $props();

  // The screen is keyed by project.
  // svelte-ignore state_referenced_locally
  const docs = new ProjectDocs(projectId);
  onDestroy(() => docs.dispose());

  let treeOpen = $state(true);
  let treeWidth = $state(256);
  /** The tree survives restarts ("ui.docTree"): shown or hidden, and its width. */
  let treeLoaded = $state(false);
  void window.skaro.invoke('app.getSetting', 'ui.docTree').then((saved) => {
    const s = saved as { open?: boolean; width?: number } | null;
    if (s?.open === false) treeOpen = false;
    if (typeof s?.width === 'number') treeWidth = Math.max(200, Math.min(400, s.width));
    treeLoaded = true;
  });
  let treeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const value = { open: treeOpen, width: treeWidth };
    if (!treeLoaded) return;
    clearTimeout(treeTimer);
    treeTimer = setTimeout(
      () => void window.skaro.invoke('app.setSetting', 'ui.docTree', value),
      300,
    );
  });
  let modal = $state<'new' | 'spec' | 'leave' | undefined>();
  /** The project has code of its own: the empty brief and architecture are optional (D-32). */
  let hasCode = $state(false);
  // svelte-ignore state_referenced_locally
  void window.skaro
    .invoke('project.hasCode', projectId)
    .then((v) => (hasCode = v))
    .catch(() => undefined);
  /** Where to go after "Отменить правки": a document, or just out of the editor. */
  let pending = $state<string | undefined>();
  let page: DocPage | undefined = $state();
  let now = $state(Date.now());

  const doc = $derived(docs.current);
  const rendered = $derived(renderDoc(docs.text));
  const missing = $derived(doc ? !docs.exists(doc.path) : false);
  const specTasks = $derived(
    doc?.spec
      ? tasks.tasks
          .filter((x) => x.spec?.id === doc.spec!.id && !x.archived)
          .map((x) => ({ id: x.id, title: x.title, status: x.status }))
      : [],
  );
  const nextSpec = $derived(
    `SPEC-${String(Math.max(0, ...docs.entries.map((d) => Number(d.spec?.id ?? 0))) + 1).padStart(
      4,
      '0',
    )}`,
  );

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  // A document asked for from outside (a task's specification) is shown once it is listed.
  let opened: string | undefined;
  $effect(() => {
    if (!docs.loaded || !open || opened === open || !docs.exists(open)) return;
    opened = open;
    void docs.open(open);
  });

  // The first document shown is the architecture, or the brief when there is none.
  $effect(() => {
    if (!docs.loaded || (open && open !== opened)) return;
    if (!docs.exists(docs.selected) && docs.exists(BRIEF) && docs.selected !== BRIEF) {
      void docs.open(BRIEF);
    }
  });

  function select(path: string): void {
    if (docs.dirty) {
      pending = path;
      modal = 'leave';
      return;
    }
    void docs.open(path).then(() => page?.top());
  }

  function cancel(): void {
    if (docs.dirty) {
      pending = undefined;
      modal = 'leave';
    } else docs.cancel();
  }

  function discard(): void {
    modal = undefined;
    docs.cancel();
    if (pending) select(pending);
    pending = undefined;
  }

  function link(href: string): void {
    const adr = adrLink(href);
    const spec = specLink(href);
    const target = adr
      ? docs.entries.find((d) => d.adr?.id === adr)
      : spec
        ? docs.entries.find((d) => d.spec?.id === spec)
        : undefined;
    if (target) select(target.path);
    else if (/^https?:\/\//i.test(href)) void window.skaro.invoke('shell.openExternal', href);
  }

  async function create(name: string): Promise<void> {
    modal = undefined;
    const entry = await window.skaro.invoke('docs.create', projectId, name);
    await docs.reload();
    await docs.open(entry.path);
    docs.edit('## ');
  }

  async function createSpec(title: string): Promise<void> {
    modal = undefined;
    const entry = await window.skaro.invoke('docs.createSpec', projectId, title);
    await docs.reload();
    await docs.open(entry.path);
  }

  function keys(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && docs.editing) {
      e.preventDefault();
      void docs.save();
    }
  }
</script>

<svelte:window onkeydown={keys} />

<div class="screen">
  {#if treeOpen}
    <DocTree
      {docs}
      bind:width={treeWidth}
      onselect={select}
      onhide={() => (treeOpen = false)}
      onnew={() => (modal = 'new')}
      onnewspec={() => (modal = 'spec')}
      {onimport}
    />
  {/if}
  <div class="main">
    {#if doc && docs.editing}
      <DocEditor
        {docs}
        title={titleOf(doc)}
        treeHidden={!treeOpen}
        onshowtree={() => (treeOpen = true)}
        oncancel={cancel}
        onlink={link}
      />
    {:else if doc}
      {#if !treeOpen}
        <button
          type="button"
          class="show-tree"
          data-tip={t('docs.tree.show')}
          onclick={() => (treeOpen = true)}><Icon name="sidebar" size={16} /></button
        >
      {/if}
      {#snippet emptyDoc()}
        {@const arch = doc.kind === 'architecture'}
        <div class="empty">
          <span class="empty-icon"><Icon name="docText" size={30} stroke={1.5} /></span>
          <div class="empty-copy">
            <span class="empty-title"
              >{hasCode
                ? t(arch ? 'docs.arch.optional.title' : 'docs.brief.optional.title')
                : t(arch ? 'docs.arch.empty.title' : 'docs.brief.empty.title')}</span
            >
            <span class="empty-text"
              >{hasCode
                ? t('docs.optional.text')
                : t(arch ? 'docs.arch.empty.text' : 'docs.brief.empty.text')}</span
            >
          </div>
          <div class="empty-actions">
            {#if !hasCode}
              <button
                type="button"
                class="secondary"
                onclick={() => docs.edit(doc.kind === 'brief' ? t('docs.brief.template') : '## ')}
                ><Icon name="edit" size={14} stroke={1.9} />{t('docs.brief.write')}</button
              >
            {/if}
            <button type="button" class="secondary" onclick={onimport}
              ><Icon name="import" size={14} stroke={1.9} />{t('docs.import')}</button
            >
            <button type="button" class="primary" onclick={onchat}
              ><Icon name="chat" size={14} stroke={2} />{t('docs.discuss')}</button
            >
          </div>
        </div>
      {/snippet}
      <div class="body">
        <DocPage
          bind:this={page}
          blocks={rendered.blocks}
          headings={rendered.headings}
          empty={missing ? emptyDoc : undefined}
          onlink={link}
        >
          {#snippet header()}
            <DocHeader
              {doc}
              {now}
              ondiscuss={onchat}
              onedit={() => docs.edit()}
              onreveal={() => void window.skaro.invoke('docs.reveal', projectId, doc.path)}
              tasks={specTasks}
              onstatus={(s) =>
                void (doc.spec
                  ? window.skaro.invoke('docs.setSpecStatus', projectId, doc.spec.id, s)
                  : window.skaro.invoke('docs.setAdrStatus', projectId, doc.adr!.id, s))}
              onadr={(id) => link(doc.kind === 'spec' ? `specs/${id}` : `adr/${id}`)}
              {ontask}
            />
          {/snippet}
        </DocPage>
      </div>
    {/if}
  </div>
</div>

{#if modal === 'new'}
  <NewDocModal oncreate={(name) => void create(name)} onclose={() => (modal = undefined)} />
{:else if modal === 'spec'}
  <NewSpecModal
    next={nextSpec}
    oncreate={(title) => void createSpec(title)}
    onclose={() => (modal = undefined)}
  />
{:else if modal === 'leave' && doc}
  <LeaveModal title={titleOf(doc)} ondiscard={discard} onstay={() => (modal = undefined)} />
{/if}

<style>
  .screen {
    flex: 1;
    min-width: 0;
    display: flex;
    background: var(--sk-fill-5);
  }

  .main {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .show-tree {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 6;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-17);
    cursor: pointer;
  }

  .show-tree:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .empty {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px 24px 80px;
    text-align: center;
  }

  .empty-icon {
    display: inline-flex;
    color: var(--sk-text-28);
  }

  .empty-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 380px;
  }

  .empty-title {
    font-size: var(--sk-fs-10);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .empty-text {
    font-size: var(--sk-fs-6);
    line-height: 1.6;
    color: var(--sk-text-19);
    text-wrap: pretty;
  }

  .empty-actions {
    display: flex;
    gap: 8px;
  }

  .secondary,
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }

  .secondary {
    padding: 0 13px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-size: var(--sk-fs-5);
    font-weight: 600;
  }

  .secondary:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .primary {
    padding: 0 15px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-size: var(--sk-fs-6);
    font-weight: 700;
  }

  .primary:hover {
    background: var(--sk-accent-hover);
  }
</style>
