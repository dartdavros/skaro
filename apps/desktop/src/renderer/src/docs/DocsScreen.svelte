<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import { ProjectDocs } from './data.svelte';
  import DocEditor from './DocEditor.svelte';
  import DocHeader from './DocHeader.svelte';
  import DocPage from './DocPage.svelte';
  import DocTree from './DocTree.svelte';
  import './i18n';
  import LeaveModal from './LeaveModal.svelte';
  import { adrLink, BRIEF, titleOf } from './model';
  import NewDocModal from './NewDocModal.svelte';
  import { renderDoc } from './render';

  /** "Документы" (Documents mockup): the tree, a document to read or edit. */
  let { projectId, onchat }: { projectId: string; onchat: () => void } = $props();

  // The screen is keyed by project.
  // svelte-ignore state_referenced_locally
  const docs = new ProjectDocs(projectId);
  onDestroy(() => docs.dispose());

  let treeOpen = $state(true);
  let treeWidth = $state(256);
  let modal = $state<'new' | 'leave' | undefined>();
  /** Where to go after "Отменить правки": a document, or just out of the editor. */
  let pending = $state<string | undefined>();
  let page: DocPage | undefined = $state();
  let now = $state(Date.now());

  const doc = $derived(docs.current);
  const rendered = $derived(renderDoc(docs.text));
  const missing = $derived(doc ? !docs.exists(doc.path) : false);

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  // The first document shown is the architecture, or the brief when there is none.
  $effect(() => {
    if (!docs.loaded) return;
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
    const target = adr ? docs.entries.find((d) => d.adr?.id === adr) : undefined;
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
        <div class="empty">
          <span class="empty-icon"><Icon name="docText" size={30} stroke={1.5} /></span>
          <div class="empty-copy">
            <span class="empty-title">{t('docs.brief.empty.title')}</span>
            <span class="empty-text">{t('docs.brief.empty.text')}</span>
          </div>
          <div class="empty-actions">
            <button
              type="button"
              class="secondary"
              onclick={() => docs.edit(doc.kind === 'brief' ? t('docs.brief.template') : '## ')}
              ><Icon name="edit" size={14} stroke={1.9} />{t('docs.brief.write')}</button
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
              onstatus={(s) =>
                void window.skaro.invoke('docs.setAdrStatus', projectId, doc.adr!.id, s)}
              onadr={(id) => link(`adr/${id}`)}
            />
          {/snippet}
        </DocPage>
      </div>
    {/if}
  </div>
</div>

{#if modal === 'new'}
  <NewDocModal oncreate={(name) => void create(name)} onclose={() => (modal = undefined)} />
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
