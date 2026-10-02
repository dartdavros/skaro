<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import type { DocsController } from './docs-controller.svelte';
  import { titleOf } from './model';
  import DocEditor from './DocEditor.svelte';
  import DocEmpty from './DocEmpty.svelte';
  import DocHeader from './DocHeader.svelte';
  import DocPage from './DocPage.svelte';
  let { model, doc }: { model: DocsController; doc: DocEntry } = $props();
</script>

{#if model.docs.editing}
  <DocEditor
    docs={model.docs}
    title={titleOf(doc)}
    treeHidden={!model.tree.open}
    onshowtree={() => (model.tree.open = true)}
    oncancel={model.cancel}
    onlink={model.link}
  />
{:else}
  {#if !model.tree.open}
    <button
      data-docs-screen
      type="button"
      class="show-tree"
      data-tip={t('docs.tree.show')}
      onclick={() => (model.tree.open = true)}><Icon name="sidebar" size={16} /></button
    >
  {/if}
  {#snippet emptyDoc()}
    <DocEmpty {model} {doc} />
  {/snippet}
  <div data-docs-screen class="body">
    <DocPage
      bind:this={model.page}
      blocks={model.rendered.blocks}
      headings={model.rendered.headings}
      empty={model.missing ? emptyDoc : undefined}
      onlink={model.link}
    >
      {#snippet header()}
        <DocHeader
          {doc}
          now={model.now}
          ondiscuss={model.p.onchat}
          onedit={() => model.docs.edit()}
          onreveal={() => void window.skaro.invoke('docs.reveal', model.p.projectId, doc.path)}
          tasks={model.specTasks}
          onstatus={(s) =>
            void (doc.spec
              ? window.skaro.invoke('docs.setSpecStatus', model.p.projectId, doc.spec.id, s)
              : window.skaro.invoke('docs.setAdrStatus', model.p.projectId, doc.adr!.id, s))}
          onadr={(id) => model.link(doc.kind === 'spec' ? `specs/${id}` : `adr/${id}`)}
          ontask={model.p.ontask}
        />
      {/snippet}
    </DocPage>
  </div>
{/if}
