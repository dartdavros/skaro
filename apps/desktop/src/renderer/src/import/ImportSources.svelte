<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ImportController } from './import-controller.svelte';
  let { state }: { state: ImportController } = $props();
</script>

{#if state.sources.length}
  <div data-import-modal class="sources">
    {#each state.sources as source (source.path)}
      <div
        data-import-modal
        class="source"
        class:broken={source.missing}
        data-tip={source.missing ? t('import.missing.tip') : undefined}
      >
        <span data-import-modal class="source-icon"
          ><Icon
            name={source.kind === 'folder'
              ? 'folderSource'
              : source.kind === 'archive'
                ? 'archive'
                : 'fileBlank'}
            size={15}
            stroke={1.8}
          /></span
        >
        <span data-import-modal class="source-path">{source.display}</span>
        <span data-import-modal class="source-count">{state.count(source)}</span>
        <button
          data-import-modal
          type="button"
          class="remove"
          data-tip={t('import.remove')}
          aria-label={t('import.remove')}
          onclick={() => (state.sources = state.sources.filter((s) => s.path !== source.path))}
          ><Icon name="close" size={12} stroke={2.2} /></button
        >
      </div>
    {/each}
  </div>
  {#if state.read > 0}
    <span data-import-modal class="note"
      >{t('import.read', { n: state.read })} ·
      <span
        data-import-modal
        class="formats"
        data-tip={t('import.formats', { list: state.formats.join(', ') })}
        >{t('import.unsupported', { n: state.unsupported })}</span
      ></span
    >
  {:else if !state.missing.length}
    <span data-import-modal class="note warn"
      >{t('import.nothing')} ·
      <span
        data-import-modal
        class="formats warn"
        data-tip={t('import.formats', { list: state.formats.join(', ') })}
        >{t('import.nothing.formats')}</span
      ></span
    >
  {/if}
{/if}
