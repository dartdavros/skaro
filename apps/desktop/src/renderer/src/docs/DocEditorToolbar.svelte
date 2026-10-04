<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { TOOLS } from './editor-tools';
  import type { EditorController } from './editor-controller.svelte';
  let { model }: { model: EditorController } = $props();
</script>

<div data-doc-editor class="toolbar">
  {#if model.p.treeHidden}
    <button
      data-doc-editor
      type="button"
      class="icon"
      data-tip={t('docs.tree.show')}
      onclick={model.p.onshowtree}><Icon name="sidebar" size={16} /></button
    >
  {/if}
  <div data-doc-editor class="name">
    <span data-doc-editor class="title">{model.p.title}</span>
    {#if model.p.docs.dirty}<span data-doc-editor class="dirty" data-tip={t('docs.dirty')}
      ></span>{/if}
  </div>
  <div data-doc-editor class="tools">
    {#each TOOLS as tool (tool.kind)}
      <button
        data-doc-editor
        type="button"
        class="icon small"
        data-tip={t(tool.tip)}
        onclick={() => void model.format(tool.kind)}
        ><Icon name={tool.icon} size={15} stroke={2} /></button
      >
    {/each}
  </div>
  <div data-doc-editor class="spacer"></div>
  <div data-doc-editor class="seg">
    {#each ['editor', 'preview', 'split'] as const as v (v)}
      <button
        data-doc-editor
        type="button"
        class:active={model.view === v}
        onclick={() => (model.view = v)}>{t(`docs.view.${v}`)}</button
      >
    {/each}
  </div>
  <button data-doc-editor type="button" class="cancel" onclick={model.p.oncancel}
    >{t('ui.cancel')}</button
  >
  <button
    data-doc-editor
    type="button"
    class="save"
    class:ready={model.p.docs.dirty}
    data-tip={t('docs.save.tip')}
    onclick={() => void model.p.docs.save()}>{t('docs.save')}</button
  >
</div>
