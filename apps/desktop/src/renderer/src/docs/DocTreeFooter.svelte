<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { TreeController } from './tree-controller.svelte';
  let { model }: { model: TreeController } = $props();
</script>

<div data-doc-tree class="foot" bind:this={model.foot}>
  {#if model.menu}
    <div data-doc-tree class="menu" role="menu">
      <button
        data-doc-tree
        type="button"
        class="menu-item"
        role="menuitem"
        onclick={() => model.pick(model.p.onnew)}
      >
        <Icon name="fileBlank" size={14} stroke={1.8} color="var(--sk-text-19)" />
        {t('docs.new')}
      </button>
      <button
        data-doc-tree
        type="button"
        class="menu-item"
        role="menuitem"
        onclick={() => model.pick(model.p.onnewspec)}
      >
        <Icon name="spec" size={14} stroke={1.8} color="var(--sk-text-19)" />
        {t('docs.newSpec')}
      </button>
    </div>
  {/if}
  <button
    data-doc-tree
    type="button"
    class="new"
    class:open={model.menu}
    aria-haspopup="menu"
    aria-expanded={model.menu}
    onclick={() => (model.menu = !model.menu)}
  >
    <Icon name="plus" size={15} stroke={2.6} />
    <span data-doc-tree class="new-label">{t('docs.new')}</span>
    <Icon name="chevronUp" size={11} stroke={2.4} />
  </button>
  <button
    data-doc-tree
    type="button"
    class="import"
    data-tip={t('docs.import')}
    aria-label={t('docs.import')}
    onclick={() => model.pick(model.p.onimport)}
    ><Icon name="import" size={15} stroke={1.8} /></button
  >
</div>
