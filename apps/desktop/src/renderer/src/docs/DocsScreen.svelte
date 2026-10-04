<script lang="ts">
  import type { DocsProps } from './docs-props';
  import { createDocsController } from './docs-controller.svelte';
  let { projectId, open, tasks, onchat, ontask, onimport }: DocsProps = $props();
  const model = createDocsController({
    get projectId() {
      return projectId;
    },
    get open() {
      return open;
    },
    get tasks() {
      return tasks;
    },
    get onchat() {
      return onchat;
    },
    get ontask() {
      return ontask;
    },
    get onimport() {
      return onimport;
    },
  });
  import { titleOf } from './model';
  import DocContent from './DocContent.svelte';
  import DocTree from './DocTree.svelte';
  import LeaveModal from './LeaveModal.svelte';
  import NewDocModal from './NewDocModal.svelte';
  import NewSpecModal from './NewSpecModal.svelte';
  import '../feed/i18n';
  import './i18n';
  import './docs-screen.css';
</script>

<svelte:window onkeydown={model.keys} />

<div data-docs-screen class="screen">
  {#if model.tree.open}
    <DocTree
      docs={model.docs}
      bind:width={model.tree.width}
      onselect={model.select}
      onhide={() => (model.tree.open = false)}
      onnew={() => (model.modal = 'new')}
      onnewspec={() => (model.modal = 'spec')}
      onimport={model.p.onimport}
    />
  {/if}
  <div data-docs-screen class="main">
    {#if model.doc}
      <DocContent {model} doc={model.doc} />
    {/if}
  </div>
</div>

{#if model.modal === 'new'}
  <NewDocModal
    oncreate={(name) => void model.create(name)}
    onclose={() => (model.modal = undefined)}
  />
{:else if model.modal === 'spec'}
  <NewSpecModal
    next={model.nextSpec}
    oncreate={(title) => void model.createSpec(title)}
    onclose={() => (model.modal = undefined)}
  />
{:else if model.modal === 'leave' && model.doc}
  <LeaveModal
    title={titleOf(model.doc)}
    ondiscard={model.discard}
    onstay={() => (model.modal = undefined)}
  />
{/if}
