<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import type { ProjectDocs } from './data.svelte';
  import { recordOf, titleOf } from './model';

  /**
   * The document tree (Documents mockup): brief, architecture, ADR, specifications and free
   * documents; "Новый документ" opens a menu, the icon next to it imports documentation.
   */
  let {
    docs,
    width = $bindable(),
    onselect,
    onhide,
    onnew,
    onnewspec,
    onimport,
  }: {
    docs: ProjectDocs;
    width: number;
    onselect: (path: string) => void;
    onhide: () => void;
    onnew: () => void;
    onnewspec: () => void;
    onimport: () => void;
  } = $props();

  let groups = $state({ adr: true, specs: true, docs: true });
  let resizing = $state(false);
  let menu = $state(false);
  let foot: HTMLDivElement | undefined = $state();

  const adrs = $derived(docs.entries.filter((d) => d.kind === 'adr'));
  const specs = $derived(docs.entries.filter((d) => d.kind === 'spec'));

  $effect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (foot && !foot.contains(e.target as Node)) menu = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menu = false;
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', esc);
    };
  });
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
    if (doc.spec?.status === 'proposed') return t('docs.spec.proposed.tip');
    if (doc.spec?.status === 'superseded')
      return t('docs.spec.replacedBy.tip', { id: doc.spec.replacedBy ?? '' });
    return undefined;
  }

  function pick(action: () => void): void {
    menu = false;
    action();
  }
</script>

{#snippet item(doc: DocEntry, icon: 'brief' | 'arch' | 'doc' | undefined)}
  {@const on = docs.selected === doc.path}
  {@const missing = !docs.exists(doc.path)}
  {@const rec = recordOf(doc)}
  <div
    class="item"
    class:on
    class:muted={missing || rec?.status === 'superseded'}
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
      <span class="num">{rec?.id}</span>
    {/if}
    <span class="label">{titleOf(doc)}</span>
    {#if rec?.status === 'proposed'}<span class="dot"></span>{/if}
  </div>
{/snippet}

{#snippet group(key: 'adr' | 'specs' | 'docs', count: number)}
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
    {#if specs.length}
      {@render group('specs', specs.length)}
      {#if groups.specs}{#each specs as doc (doc.path)}{@render item(doc, undefined)}{/each}{/if}
    {/if}
    {@render group('docs', free.length)}
    {#if groups.docs}{#each free as doc (doc.path)}{@render item(doc, 'doc')}{/each}{/if}
  </div>
  <div class="foot" bind:this={foot}>
    {#if menu}
      <div class="menu" role="menu">
        <button type="button" class="menu-item" role="menuitem" onclick={() => pick(onnew)}>
          <Icon name="fileBlank" size={14} stroke={1.8} color="var(--sk-text-19)" />
          {t('docs.new')}
        </button>
        <button type="button" class="menu-item" role="menuitem" onclick={() => pick(onnewspec)}>
          <Icon name="spec" size={14} stroke={1.8} color="var(--sk-text-19)" />
          {t('docs.newSpec')}
        </button>
      </div>
    {/if}
    <button
      type="button"
      class="new"
      class:open={menu}
      aria-haspopup="menu"
      aria-expanded={menu}
      onclick={() => (menu = !menu)}
    >
      <Icon name="plus" size={15} stroke={2.6} />
      <span class="new-label">{t('docs.new')}</span>
      <Icon name="chevronUp" size={11} stroke={2.4} />
    </button>
    <button
      type="button"
      class="import"
      data-tip={t('docs.import')}
      aria-label={t('docs.import')}
      onclick={() => pick(onimport)}><Icon name="import" size={15} stroke={1.8} /></button
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--sk-fill-11);
  }

  .menu {
    position: absolute;
    left: 8px;
    bottom: 46px;
    z-index: 30;
    width: 220px;
    padding: 5px;
    border-radius: 10px;
    background: var(--sk-menu);
    box-shadow: var(--sk-menu-shadow);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 9px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-6);
    font: inherit;
    font-size: var(--sk-fs-6);
    text-align: left;
    cursor: pointer;
  }

  .menu-item:hover {
    background: var(--sk-menu-hover);
  }

  .new-label {
    flex: 1;
    text-align: left;
  }

  .import {
    flex: none;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--sk-text-17);
    cursor: pointer;
  }

  .import:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .new {
    flex: 1;
    min-width: 0;
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

  .new:hover,
  .new.open {
    background: var(--sk-fill-11);
  }

  .new:hover {
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
