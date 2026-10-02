<script lang="ts">
  import type { TreeProps } from './tree-props';
  import { createTreeController } from './tree-controller.svelte';
  let {
    docs,
    width = $bindable(),
    onselect,
    onhide,
    onnew,
    onnewspec,
    onimport,
  }: TreeProps = $props();
  const model = createTreeController({
    get docs() {
      return docs;
    },
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
    },
    get onselect() {
      return onselect;
    },
    get onhide() {
      return onhide;
    },
    get onnew() {
      return onnew;
    },
    get onnewspec() {
      return onnewspec;
    },
    get onimport() {
      return onimport;
    },
  });
  import { Icon, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import { recordOf, titleOf } from './model';
  import DocTreeFooter from './DocTreeFooter.svelte';
  import './doc-tree.css';
</script>

{#snippet item(doc: DocEntry, icon: 'brief' | 'arch' | 'doc' | undefined)}
  {@const on = model.p.docs.selected === doc.path}
  {@const missing = !model.p.docs.exists(doc.path)}
  {@const rec = recordOf(doc)}
  <div
    data-doc-tree
    class="item"
    class:on
    class:muted={missing || rec?.status === 'superseded'}
    role="treeitem"
    aria-selected={on}
    tabindex="0"
    data-tip={model.tip(doc, missing)}
    onclick={() => model.p.onselect(doc.path)}
    onkeydown={(e) => e.key === 'Enter' && model.p.onselect(doc.path)}
  >
    {#if icon}
      <span data-doc-tree class="icon"
        ><Icon
          name={icon === 'brief' ? 'docText' : icon === 'arch' ? 'layers' : 'fileBlank'}
          size={15}
        /></span
      >
    {:else}
      <span data-doc-tree class="num">{rec?.id}</span>
    {/if}
    <span data-doc-tree class="label">{titleOf(doc)}</span>
    {#if rec?.status === 'proposed'}<span data-doc-tree class="dot"></span>{/if}
  </div>
{/snippet}

{#snippet group(key: 'adr' | 'specs' | 'docs', count: number)}
  <div
    data-doc-tree
    class="group"
    role="button"
    tabindex="0"
    onclick={() => (model.groups = { ...model.groups, [key]: !model.groups[key] })}
    onkeydown={(e) =>
      e.key === 'Enter' && (model.groups = { ...model.groups, [key]: !model.groups[key] })}
  >
    <span data-doc-tree class="chev" class:open={model.groups[key]}
      ><Icon name="chevronRight" size={12} stroke={2.4} /></span
    >
    <span data-doc-tree class="group-label">{t(`docs.group.${key}`)}</span>
    <span data-doc-tree class="count">{count}</span>
  </div>
{/snippet}

<div data-doc-tree class="tree" style="width: {model.p.width}px">
  <div data-doc-tree class="head">
    <span data-doc-tree class="title">{t('docs.title')}</span>
    <button
      data-doc-tree
      type="button"
      class="hide"
      data-tip={t('docs.tree.hide')}
      onclick={model.p.onhide}><Icon name="sidebar" size={16} /></button
    >
  </div>
  <div data-doc-tree class="items" role="tree">
    {@render item(model.fixed[0]!, 'brief')}
    {@render item(model.fixed[1]!, 'arch')}
    {@render group('adr', model.adrs.length)}
    {#if model.groups.adr}{#each model.adrs as doc (doc.path)}{@render item(
          doc,
          undefined,
        )}{/each}{/if}
    {#if model.specs.length}
      {@render group('specs', model.specs.length)}
      {#if model.groups.specs}{#each model.specs as doc (doc.path)}{@render item(
            doc,
            undefined,
          )}{/each}{/if}
    {/if}
    {@render group('docs', model.free.length)}
    {#if model.groups.docs}{#each model.free as doc (doc.path)}{@render item(
          doc,
          'doc',
        )}{/each}{/if}
  </div>
  <DocTreeFooter {model} />
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    data-doc-tree
    class="resize"
    role="separator"
    data-tip={t('docs.tree.resize')}
    onmousedown={model.resize}
  >
    <span data-doc-tree class="line" class:on={model.resizing}></span>
  </div>
</div>
