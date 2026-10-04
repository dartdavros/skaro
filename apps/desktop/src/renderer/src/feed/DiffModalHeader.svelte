<script lang="ts">
  import { CodeXml, File, Maximize2, Minimize2 } from '@lucide/svelte';
  import { Icon, t } from '@skaro/ui';
  import './diff-modal-header.css';

  /**
   * The head of the diff window: the file (folder muted, name bright), +/−, "новый файл" or
   * "удалён", the status line; the file switcher, refresh, expand and close on the right.
   */
  let {
    path,
    code,
    added,
    removed,
    badge,
    sub,
    index,
    count,
    spin,
    expanded,
    onprev,
    onnext,
    onrefresh,
    ontoggle,
    onclose,
  }: {
    path: string;
    code: boolean;
    added: number;
    removed: number;
    badge: 'new' | 'deleted' | undefined;
    sub: string;
    index: number;
    count: number;
    spin: number;
    expanded: boolean;
    onprev: () => void;
    onnext: () => void;
    onrefresh: () => void;
    ontoggle: () => void;
    onclose: () => void;
  } = $props();

  const cut = $derived(path.lastIndexOf('/') + 1);
</script>

<div class="dm-head">
  <span class="dm-file-icon"
    >{#if code}<CodeXml size={16} strokeWidth={2} />{:else}<File
        size={15}
        strokeWidth={2}
      />{/if}</span
  >
  <div class="dm-titles">
    <span class="dm-title-line">
      <span class="dm-path"
        ><span class="dm-dir">{path.slice(0, cut)}</span><span class="dm-name"
          >{path.slice(cut)}</span
        ></span
      >
      <span class="dm-counts"
        ><span class="dm-plus">+{added}</span><span class="dm-minus">−{removed}</span></span
      >
      {#if badge}<span class="dm-badge {badge}"
          >{badge === 'new' ? t('diff.new') : t('diff.deleted')}</span
        >{/if}
    </span>
    <span class="dm-sub">{sub}</span>
  </div>
  <div class="dm-switch">
    <button
      type="button"
      class="dm-step"
      disabled={index === 0}
      data-tip={t('diff.prev')}
      aria-label={t('diff.prev')}
      onclick={onprev}><Icon name="chevronLeft" size={14} stroke={2.2} /></button
    >
    <span class="dm-pos">{index + 1} / {count}</span>
    <button
      type="button"
      class="dm-step"
      disabled={index === count - 1}
      data-tip={t('diff.next')}
      aria-label={t('diff.next')}
      onclick={onnext}><Icon name="chevronRight" size={14} stroke={2.2} /></button
    >
  </div>
  <div class="dm-divider"></div>
  <button
    type="button"
    class="dm-btn"
    data-tip={t('diff.refresh')}
    aria-label={t('diff.refresh')}
    onclick={onrefresh}
  >
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="transform: rotate({spin}deg); transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)"
      ><path
        d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"
      /></svg
    >
  </button>
  <button
    type="button"
    class="dm-btn"
    data-tip={expanded ? t('diff.collapse') : t('diff.expand')}
    aria-label={expanded ? t('diff.collapse') : t('diff.expand')}
    onclick={ontoggle}
  >
    {#if expanded}<Minimize2 size={15} strokeWidth={1.9} />{:else}<Maximize2
        size={15}
        strokeWidth={1.9}
      />{/if}
  </button>
  <button
    type="button"
    class="dm-btn"
    data-tip={t('ui.closeEsc')}
    aria-label={t('ui.close')}
    onclick={onclose}><Icon name="close" size={14} stroke={2.2} /></button
  >
</div>
