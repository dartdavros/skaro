<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import type { ProjectDocs } from './data.svelte';
  import { titleOf } from './model';

  /** The document tree (Documents mockup): brief, architecture, ADR and free documents. */
  let {
    docs,
    width = $bindable(),
    onselect,
    onhide,
    onnew,
  }: {
    docs: ProjectDocs;
    width: number;
    onselect: (path: string) => void;
    onhide: () => void;
    onnew: () => void;
  } = $props();

  let groups = $state({ adr: true, docs: true });
  let resizing = $state(false);

  const adrs = $derived(docs.entries.filter((d) => d.kind === 'adr'));
  const free = $derived(docs.entries.filter((d) => d.kind === 'doc'));
  const fixed = $derived(docs.all.slice(0, 2));

  function resize(e: MouseEvent): void {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    resizing = true;
    const move = (ev: MouseEvent) => (width = Math.max(200, Math.min(400, w0 + ev.clientX - x0)));
    const up = () => {
      resizing = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function tip(doc: DocEntry, missing: boolean): string | undefined {
    if (missing) return t('docs.missing');
    if (doc.adr?.status === 'proposed') return t('docs.adr.proposed.tip');
    if (doc.adr?.status === 'superseded')
      return t('docs.adr.replacedBy.tip', { id: doc.adr.replacedBy ?? '' });
    return undefined;
  }
</script>

{#snippet item(doc: DocEntry, icon: 'brief' | 'arch' | 'doc' | undefined)}
  {@const on = docs.selected === doc.path}
  {@const missing = !docs.exists(doc.path)}
  <div
    class="item"
    class:on
    class:muted={missing || doc.adr?.status === 'superseded'}
    role="treeitem"
    aria-selected={on}
    tabindex="0"
    data-tip={tip(doc, missing)}
    onclick={() => onselect(doc.path)}
    onkeydown={(e) => e.key === 'Enter' && onselect(doc.path)}
  >
    {#if icon}
      <span class="icon"
        ><Icon
          name={icon === 'brief' ? 'docText' : icon === 'arch' ? 'layers' : 'fileBlank'}
          size={15}
        /></span
      >
    {:else}
      <span class="num">{doc.adr?.id}</span>
    {/if}
    <span class="label">{titleOf(doc)}</span>
    {#if doc.adr?.status === 'proposed'}<span class="dot"></span>{/if}
  </div>
{/snippet}

{#snippet group(key: 'adr' | 'docs', count: number)}
  <div
    class="group"
    role="button"
    tabindex="0"
    onclick={() => (groups = { ...groups, [key]: !groups[key] })}
    onkeydown={(e) => e.key === 'Enter' && (groups = { ...groups, [key]: !groups[key] })}
  >
    <span class="chev" class:open={groups[key]}
      ><Icon name="chevronRight" size={12} stroke={2.4} /></span
    >
    <span class="group-label">{t(`docs.group.${key}`)}</span>
    <span class="count">{count}</span>
  </div>
{/snippet}

<div class="tree" style="width: {width}px">
  <div class="head">
    <span class="title">{t('docs.title')}</span>
    <button type="button" class="hide" data-tip={t('docs.tree.hide')} onclick={onhide}
      ><Icon name="sidebar" size={16} /></button
    >
  </div>
  <div class="items" role="tree">
    {@render item(fixed[0]!, 'brief')}
    {@render item(fixed[1]!, 'arch')}
    {@render group('adr', adrs.length)}
    {#if groups.adr}{#each adrs as doc (doc.path)}{@render item(doc, undefined)}{/each}{/if}
    {@render group('docs', free.length)}
    {#if groups.docs}{#each free as doc (doc.path)}{@render item(doc, 'doc')}{/each}{/if}
  </div>
  <div class="foot">
    <button type="button" class="new" onclick={onnew}
      ><Icon name="plus" size={15} stroke={2.6} />{t('docs.new')}</button
    >
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="resize" role="separator" data-tip={t('docs.tree.resize')} onmousedown={resize}>
    <span class="line" class:on={resizing}></span>
  </div>
</div>

<style>
  .tree {
    flex: none;
    position: relative;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--sk-fill-16);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 8px 0 16px;
  }

  .title {
    font-size: var(--sk-fs-8);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .hide {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-21);
    cursor: pointer;
  }

  .hide:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .items {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    margin-top: 10px;
    padding: 0 8px 0 6px;
    border-radius: 7px;
    cursor: pointer;
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
    outline: none;
  }

  .group:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-13);
  }

  .chev {
    display: inline-flex;
    color: var(--sk-text-23);
    transition: transform 0.15s;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .group-label {
    flex: 1;
  }

  .count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    font-weight: 400;
    letter-spacing: 0;
    color: var(--sk-text-26);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--sk-text-13);
    outline: none;
  }

  .item:hover {
    background: var(--sk-fill-11);
  }

  .item.on {
    background: var(--sk-fill-15);
    color: var(--sk-text-6);
  }

  .item.muted {
    color: var(--sk-text-23);
  }

  .icon {
    flex: none;
    display: inline-flex;
    color: var(--sk-text-23);
  }

  .item.on .icon {
    color: var(--sk-text-6);
  }

  .num {
    flex: none;
    width: 32px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .label {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item.on .label {
    font-weight: 600;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-accent);
  }

  .foot {
    flex: none;
    padding: 8px;
    border-top: 1px solid var(--sk-fill-11);
  }

  .new {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--sk-text-13);
    font-size: var(--sk-fs-6);
    font-weight: 600;
    cursor: pointer;
  }

  .new:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -4px;
    width: 8px;
    z-index: 5;
    cursor: col-resize;
    display: flex;
    justify-content: center;
  }

  .line {
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background 0.15s;
  }

  .line.on {
    background: var(--sk-accent);
  }
</style>
