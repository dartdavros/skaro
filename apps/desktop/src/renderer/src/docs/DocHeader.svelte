<script lang="ts">
  import { Icon, Popover, t } from '@skaro/ui';
  import type { DocEntry } from '../../../shared/ipc';
  import { ADR_STATUS, adrDate, edited, titleOf, type AdrStatus } from './model';

  /** Title, path and actions of an open document; status and links of an ADR (Documents mockup). */
  let {
    doc,
    now,
    ondiscuss,
    onedit,
    onreveal,
    onstatus,
    onadr,
  }: {
    doc: DocEntry;
    now: number;
    ondiscuss: () => void;
    onedit: () => void;
    onreveal: () => void;
    onstatus: (status: AdrStatus) => void;
    onadr: (id: string) => void;
  } = $props();

  let menu = $state(false);
  const adr = $derived(doc.adr);
</script>

<div class="header">
  <div class="top">
    <div class="titles">
      {#if adr}<span class="adr-id">ADR-{adr.id}</span>{/if}
      <h1>{titleOf(doc)}</h1>
      <div class="meta">
        <span class="path">{doc.path}</span>
        <span class="sep">·</span>
        <span>{t('docs.edited', { when: edited(doc.editedAt, now) })}</span>
      </div>
    </div>
    <div class="actions">
      <button type="button" class="btn" data-tip={t('docs.discuss.tip')} onclick={ondiscuss}
        ><Icon name="chat" size={14} stroke={1.9} />{t('docs.discuss')}</button
      >
      <button type="button" class="btn" onclick={onedit}
        ><Icon name="edit" size={14} stroke={1.9} />{t('docs.edit')}</button
      >
      <button type="button" class="icon" data-tip={t('docs.reveal')} onclick={onreveal}
        ><Icon name="folderOpen" size={16} /></button
      >
    </div>
  </div>
  {#if adr}
    <div class="adr">
      <Popover bind:open={menu} width={200} offset={32}>
        {#snippet trigger({ toggle })}
          <button
            type="button"
            class="status"
            class:open={menu}
            data-tip={t('docs.adr.status.tip')}
            onclick={toggle}
          >
            <span class="dot" style="background: {ADR_STATUS[adr.status].dot}"></span>
            {t(ADR_STATUS[adr.status].label)}
            <span class="chev"><Icon name="chevronDown" size={11} stroke={2.4} /></span>
          </button>
        {/snippet}
        {#snippet children({ close })}
          {#each ['proposed', 'accepted', 'superseded'] as const as s (s)}
            <div
              class="opt"
              class:on={adr.status === s}
              role="menuitemradio"
              aria-checked={adr.status === s}
              tabindex="-1"
              onclick={() => {
                close();
                onstatus(s);
              }}
              onkeydown={(e) => e.key === 'Enter' && onstatus(s)}
            >
              <span class="dot" style="background: {ADR_STATUS[s].dot}"></span>
              <span class="opt-label">{t(ADR_STATUS[s].label)}</span>
              <span class="check" class:on={adr.status === s}
                ><Icon name="check" size={13} stroke={2.6} /></span
              >
            </div>
          {/each}
        {/snippet}
      </Popover>
      {#if adr.date}<span class="muted">{adrDate(adr.date)}</span>{/if}
      {#if adr.replaces}
        <span class="muted"
          >{t('docs.adr.replaces')}
          <a href="#{adr.replaces}" onclick={(e) => (e.preventDefault(), onadr(adr.replaces!))}
            >ADR-{adr.replaces}</a
          ></span
        >
      {/if}
      {#if adr.status === 'superseded' && adr.replacedBy}
        <span class="muted"
          >{t('docs.adr.replacedBy')}
          <a href="#{adr.replacedBy}" onclick={(e) => (e.preventDefault(), onadr(adr.replacedBy!))}
            >ADR-{adr.replacedBy}</a
          ></span
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 6px;
  }

  .top {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .titles {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .adr-id {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    font-weight: 600;
    color: var(--sk-text-19);
  }

  h1 {
    margin: 0;
    font-size: var(--sk-fs-17);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
    white-space: nowrap;
  }

  .path {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
  }

  .sep {
    color: var(--sk-text-29);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 13px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .btn:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .icon {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-17);
    cursor: pointer;
  }

  .icon:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .adr {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 9px 0 10px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-16);
    color: var(--sk-text-7);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .status:hover,
  .status.open {
    background: var(--sk-fill-22);
    color: var(--sk-text-2);
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .chev {
    display: inline-flex;
    color: var(--sk-text-21);
  }

  .opt {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border-radius: 7px;
    cursor: pointer;
  }

  .opt:hover {
    background: var(--sk-fill-27);
  }

  .opt.on {
    background: var(--sk-fill-26);
  }

  .opt-label {
    flex: 1;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-6);
  }

  .check {
    display: inline-flex;
    color: transparent;
  }

  .check.on {
    color: var(--sk-text-2);
  }

  .muted {
    font-size: var(--sk-fs-5);
    color: var(--sk-text-21);
  }

  a {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-link);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
