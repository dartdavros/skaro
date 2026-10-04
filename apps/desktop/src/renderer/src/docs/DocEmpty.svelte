<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import type { DocsController } from './docs-controller.svelte';
  let { model, doc }: { model: DocsController; doc: DocEntry } = $props();
  const arch = $derived(doc.kind === 'architecture');
</script>

<div data-docs-screen class="empty">
  <span data-docs-screen class="empty-icon"><Icon name="docText" size={30} stroke={1.5} /></span>
  <div data-docs-screen class="empty-copy">
    <span data-docs-screen class="empty-title"
      >{model.hasCode
        ? t(arch ? 'docs.arch.optional.title' : 'docs.brief.optional.title')
        : t(arch ? 'docs.arch.empty.title' : 'docs.brief.empty.title')}</span
    >
    <span data-docs-screen class="empty-text"
      >{model.hasCode
        ? t('docs.optional.text')
        : t(arch ? 'docs.arch.empty.text' : 'docs.brief.empty.text')}</span
    >
  </div>
  <div data-docs-screen class="empty-actions">
    {#if !model.hasCode}
      <button
        data-docs-screen
        type="button"
        class="secondary"
        onclick={() => model.docs.edit(doc.kind === 'brief' ? t('docs.brief.template') : '## ')}
        ><Icon name="edit" size={14} stroke={1.9} />{t('docs.brief.write')}</button
      >
    {/if}
    <button data-docs-screen type="button" class="secondary" onclick={model.p.onimport}
      ><Icon name="import" size={14} stroke={1.9} />{t('docs.import')}</button
    >
    <button data-docs-screen type="button" class="primary" onclick={model.p.onchat}
      ><Icon name="chat" size={14} stroke={2} />{t('docs.discuss')}</button
    >
  </div>
</div>
