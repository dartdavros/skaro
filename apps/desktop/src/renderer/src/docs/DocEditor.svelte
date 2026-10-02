<script lang="ts">
  import { Icon, t, type IconName } from '@skaro/ui';
  import { tick } from 'svelte';
  import type { ProjectDocs } from './data.svelte';
  import DocPage from './DocPage.svelte';
  import { applyFormat, type Format } from './format';
  import { renderDoc } from './render';

  /** Editing a document (Documents mockup): toolbar, editor, preview side by side. */
  let {
    docs,
    title,
    treeHidden,
    onshowtree,
    oncancel,
    onlink,
  }: {
    docs: ProjectDocs;
    title: string;
    treeHidden: boolean;
    onshowtree: () => void;
    oncancel: () => void;
    onlink: (href: string) => void;
  } = $props();

  let view = $state<'editor' | 'preview' | 'split'>('split');
  let area: HTMLTextAreaElement | undefined = $state();
  const rendered = $derived(renderDoc(docs.draft));

  const TOOLS: { kind: Format; icon: IconName; tip: string }[] = [
    { kind: 'bold', icon: 'bold', tip: 'docs.fmt.bold' },
    { kind: 'italic', icon: 'italic', tip: 'docs.fmt.italic' },
    { kind: 'heading', icon: 'heading', tip: 'docs.fmt.heading' },
    { kind: 'list', icon: 'list', tip: 'docs.fmt.list' },
    { kind: 'code', icon: 'code', tip: 'docs.fmt.code' },
    { kind: 'link', icon: 'link', tip: 'docs.fmt.link' },
    { kind: 'table', icon: 'table', tip: 'docs.fmt.table' },
  ];

  $effect(() => {
    area?.focus();
  });

  async function format(kind: Format): Promise<void> {
    if (!area) return;
    const next = applyFormat(kind, docs.draft, area.selectionStart, area.selectionEnd);
    docs.draft = next.text;
    await tick();
    area.focus();
    area.setSelectionRange(next.start, next.end);
  }

  function keys(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'i') {
      e.preventDefault();
      void format(key === 'b' ? 'bold' : 'italic');
    }
  }
</script>

<div class="toolbar">
  {#if treeHidden}
    <button type="button" class="icon" data-tip={t('docs.tree.show')} onclick={onshowtree}
      ><Icon name="sidebar" size={16} /></button
    >
  {/if}
  <div class="name">
    <span class="title">{title}</span>
    {#if docs.dirty}<span class="dirty" data-tip={t('docs.dirty')}></span>{/if}
  </div>
  <div class="tools">
    {#each TOOLS as tool (tool.kind)}
      <button
        type="button"
        class="icon small"
        data-tip={t(tool.tip)}
        onclick={() => void format(tool.kind)}
        ><Icon name={tool.icon} size={15} stroke={2} /></button
      >
    {/each}
  </div>
  <div class="spacer"></div>
  <div class="seg">
    {#each ['editor', 'preview', 'split'] as const as v (v)}
      <button type="button" class:active={view === v} onclick={() => (view = v)}
        >{t(`docs.view.${v}`)}</button
      >
    {/each}
  </div>
  <button type="button" class="cancel" onclick={oncancel}>{t('ui.cancel')}</button>
  <button
    type="button"
    class="save"
    class:ready={docs.dirty}
    data-tip={t('docs.save.tip')}
    onclick={() => void docs.save()}>{t('docs.save')}</button
  >
</div>

{#if docs.conflict !== undefined}
  <div class="conflict">
    <span class="warn"><Icon name="warning" size={16} stroke={1.9} /></span>
    <span class="conflict-text"
      ><span class="strong">{t('docs.conflict.title')}</span> {t('docs.conflict.text')}</span
    >
    <button type="button" class="link" onclick={() => docs.resolve(true)}
      >{t('docs.conflict.load')}</button
    >
    <button type="button" class="link" onclick={() => docs.resolve(false)}
      >{t('docs.conflict.keep')}</button
    >
  </div>
{/if}

<div class="body">
  {#if view !== 'preview'}
    <div class="editor" class:split={view === 'split'}>
      <textarea bind:this={area} bind:value={docs.draft} onkeydown={keys} spellcheck="false"
      ></textarea>
    </div>
  {/if}
  {#if view !== 'editor'}
    <DocPage blocks={rendered.blocks} headings={rendered.headings} editing {onlink} />
  {/if}
</div>

<style>
  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 52px;
    padding: 0 16px;
    border-bottom: 1px solid var(--sk-fill-16);
  }

  .name {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title {
    font-size: var(--sk-fs-8);
    font-weight: 700;
    color: var(--sk-text-6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-accent);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 8px;
    border-left: 1px solid var(--sk-fill-20);
  }

  .icon {
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

  .icon.small {
    width: 28px;
    height: 28px;
  }

  .icon:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .spacer {
    flex: 1;
  }

  .seg {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--sk-deep);
  }

  .seg button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 27px;
    padding: 0 11px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-17);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg button:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-6);
  }

  .seg button.active {
    background: var(--sk-bg);
    color: var(--sk-text-2);
    box-shadow: 0 1px 2px var(--sk-black-a35);
  }

  .cancel,
  .save {
    display: inline-flex;
    align-items: center;
    height: 32px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-5);
  }

  .cancel {
    gap: 7px;
    padding: 0 13px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .save {
    padding: 0 14px;
    background: var(--sk-fill-20);
    color: var(--sk-text-23);
    font-weight: 700;
    cursor: default;
  }

  .save.ready {
    background: var(--sk-accent);
    color: var(--sk-text-1);
    cursor: pointer;
  }

  .save.ready:hover {
    background: var(--sk-accent-hover);
  }

  .conflict {
    flex: none;
    margin: 10px 16px 0;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 10px 10px 14px;
    border-radius: 9px;
    background: var(--sk-warn-a10);
    color: var(--sk-warn);
  }

  .warn {
    flex: none;
    display: inline-flex;
  }

  .conflict-text {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
  }

  .strong {
    font-weight: 600;
  }

  .link {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .editor {
    flex: 1;
    min-width: 0;
    display: flex;
    padding: 14px 16px 16px;
  }

  .editor.split {
    border-right: 1px solid var(--sk-fill-16);
  }

  textarea {
    flex: 1;
    width: 100%;
    height: 100%;
    padding: 14px 16px;
    border: none;
    border-radius: 10px;
    background: var(--sk-fill-11);
    color: var(--sk-text-6);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-6);
    line-height: 1.7;
    resize: none;
    outline: none;
  }

  textarea:focus {
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }
</style>
