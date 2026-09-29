<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { Snippet } from 'svelte';
  import { tocPanel } from '../side-panels.svelte';
  import DocArticle from './DocArticle.svelte';
  import type { Block, Heading } from './render';

  /**
   * A scrolling document page: the article and "На странице" beside it (Documents mockup), shown
   * by the button at the top right.
   */
  let {
    blocks,
    headings,
    editing = false,
    header,
    empty,
    onlink,
  }: {
    blocks: Block[];
    headings: Heading[];
    /** The preview of the editor: tighter padding, no table of contents. */
    editing?: boolean;
    header?: Snippet;
    empty?: Snippet;
    onlink: (href: string) => void;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  let active = $state<string | undefined>();

  const current = $derived(active ?? headings[0]?.hid);
  const toc = $derived(!editing && headings.length >= 3);

  export function top(): void {
    root?.scrollTo({ top: 0 });
    active = undefined;
  }

  function scroll(): void {
    if (!root || editing) return;
    const hs = [...root.querySelectorAll<HTMLElement>('[data-hid]')];
    let cur: string | undefined;
    for (const h of hs) if (h.offsetTop - 60 <= root.scrollTop) cur = h.dataset['hid'];
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4 && hs.length) {
      cur = hs.at(-1)!.dataset['hid'];
    }
    if (cur) active = cur;
  }

  function go(hid: string): void {
    const target = root?.querySelector<HTMLElement>(`[data-hid="${hid}"]`);
    if (target) root?.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' });
    active = hid;
  }
</script>

<div class="frame">
<div class="page" bind:this={root} onscroll={scroll}>
  {#if empty}
    {@render empty()}
  {:else}
    <div class="wrap" class:editing>
      <article>
        {@render header?.()}
        <DocArticle {blocks} {onlink} />
        {#if editing && !blocks.length}<span class="blank">{t('docs.blank')}</span>{/if}
      </article>
      {#if toc && tocPanel.open}
        <nav>
          <span class="toc-title">{t('docs.toc')}</span>
          {#each headings as h (h.hid)}
            <div
              class="toc-item"
              class:on={h.hid === current}
              role="link"
              tabindex="0"
              onclick={() => go(h.hid)}
              onkeydown={(e) => e.key === 'Enter' && go(h.hid)}
            >
              {h.text}
            </div>
          {/each}
        </nav>
      {/if}
    </div>
  {/if}
</div>
{#if toc && !empty}
  <button
    type="button"
    class="toc-toggle"
    class:on={tocPanel.open}
    data-tip={tocPanel.open ? t('docs.toc.hide') : t('docs.toc.show')}
    aria-label={t('docs.toc')}
    aria-pressed={tocPanel.open}
    onclick={() => (tocPanel.open = !tocPanel.open)}><Icon name="list" size={16} /></button
  >
{/if}
</div>

<style>
  .frame {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
  }

  .toc-toggle {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 6;
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

  .toc-toggle:hover,
  .toc-toggle.on {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .page {
    flex: 1;
    min-width: 0;
    position: relative;
    overflow-y: auto;
  }

  .wrap {
    display: flex;
    justify-content: center;
    gap: 44px;
    padding: 32px 36px 80px;
  }

  .wrap.editing {
    padding: 22px 28px 60px;
  }

  article {
    flex: 1;
    min-width: 0;
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .blank {
    font-size: var(--sk-fs-6);
    color: var(--sk-text-23);
  }

  nav {
    flex: none;
    width: 184px;
    position: sticky;
    top: 28px;
    align-self: flex-start;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toc-title {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
    padding: 0 10px 8px;
  }

  .toc-item {
    padding: 5px 10px;
    border-radius: 7px;
    font-size: var(--sk-fs-5);
    line-height: 1.4;
    color: var(--sk-text-19);
    cursor: pointer;
    outline: none;
  }

  .toc-item:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-6);
  }

  .toc-item.on {
    color: var(--sk-text-6);
    font-weight: 600;
  }
</style>
