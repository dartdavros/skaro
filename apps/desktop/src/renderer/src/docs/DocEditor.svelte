<script lang="ts">
  import type { EditorProps } from './editor-props';
  import { createEditorController } from './editor-controller.svelte';
  let { docs, title, treeHidden, onshowtree, oncancel, onlink }: EditorProps = $props();
  const model = createEditorController({
    get docs() {
      return docs;
    },
    get title() {
      return title;
    },
    get treeHidden() {
      return treeHidden;
    },
    get onshowtree() {
      return onshowtree;
    },
    get oncancel() {
      return oncancel;
    },
    get onlink() {
      return onlink;
    },
  });
  import { Icon, t } from '@skaro/ui';
  import DocEditorToolbar from './DocEditorToolbar.svelte';
  import DocPage from './DocPage.svelte';
  import './doc-editor.css';
</script>

<DocEditorToolbar {model} />

{#if model.p.docs.conflict !== undefined}
  <div data-doc-editor class="conflict">
    <span data-doc-editor class="warn"><Icon name="warning" size={16} stroke={1.9} /></span>
    <span data-doc-editor class="conflict-text"
      ><span data-doc-editor class="strong">{t('docs.conflict.title')}</span>
      {t('docs.conflict.text')}</span
    >
    <button data-doc-editor type="button" class="link" onclick={() => model.p.docs.resolve(true)}
      >{t('docs.conflict.load')}</button
    >
    <button data-doc-editor type="button" class="link" onclick={() => model.p.docs.resolve(false)}
      >{t('docs.conflict.keep')}</button
    >
  </div>
{/if}

<div data-doc-editor class="body">
  {#if model.view !== 'preview'}
    <div data-doc-editor class="editor" class:split={model.view === 'split'}>
      <textarea
        data-doc-editor
        bind:this={model.area}
        bind:value={model.p.docs.draft}
        onkeydown={model.keys}
        spellcheck="false"></textarea>
    </div>
  {/if}
  {#if model.view !== 'editor'}
    <DocPage
      blocks={model.rendered.blocks}
      headings={model.rendered.headings}
      editing
      onlink={model.p.onlink}
    />
  {/if}
</div>
