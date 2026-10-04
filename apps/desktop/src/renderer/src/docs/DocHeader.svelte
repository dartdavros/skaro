<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { codeOf, edited, recordOf, titleOf } from './model';
  import type { HeaderProps } from './header-props';
  import DocRecordMetadata from './DocRecordMetadata.svelte';
  import DocSpecificationTasks from './DocSpecificationTasks.svelte';
  import './doc-header.css';
  let {
    doc,
    now,
    tasks = [],
    ondiscuss,
    onedit,
    onreveal,
    onstatus,
    onadr,
    ontask,
  }: HeaderProps = $props();
  let menu = $state(false);
  const adr = $derived(recordOf(doc));
  const isSpec = $derived(doc.kind === 'spec');
</script>

<div data-doc-header class="header">
  <div data-doc-header class="top">
    <div data-doc-header class="titles">
      {#if adr}<span data-doc-header class="adr-id">{codeOf(doc, adr.id)}</span>{/if}
      <h1 data-doc-header>{titleOf(doc)}</h1>
      <div data-doc-header class="meta">
        <span data-doc-header class="path">{doc.path}</span>
        <span data-doc-header class="sep">·</span>
        <span data-doc-header>{t('docs.edited', { when: edited(doc.editedAt, now) })}</span>
      </div>
    </div>
    <div data-doc-header class="actions">
      <button
        data-doc-header
        type="button"
        class="btn"
        data-tip={t('docs.discuss.tip')}
        onclick={ondiscuss}><Icon name="chat" size={14} stroke={1.9} />{t('docs.discuss')}</button
      >
      <button data-doc-header type="button" class="btn" onclick={onedit}
        ><Icon name="edit" size={14} stroke={1.9} />{t('docs.edit')}</button
      >
      <button
        data-doc-header
        type="button"
        class="icon"
        data-tip={t('docs.reveal')}
        onclick={onreveal}><Icon name="folderOpen" size={16} /></button
      >
    </div>
  </div>
  {#if adr}
    <DocRecordMetadata {doc} {adr} {isSpec} bind:menu {onstatus} {onadr} />
  {/if}
  {#if isSpec && tasks.length}
    <DocSpecificationTasks {tasks} {ontask} />
  {/if}
</div>
