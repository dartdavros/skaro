<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { Snippet } from 'svelte';
  import { tocPanel } from '../side-panels.svelte';
  import DocArticle from './DocArticle.svelte';
  import type { Block, Heading } from './render';
  import type { DocumentProjection } from './projection.svelte';

  /**
   * A scrolling document page: the article and "На странице" beside it (Documents mockup), shown
   * by the button at the top right.
   */
  let {
    blocks = [],
    headings = [],
    projection,
    copyText,
    editing = false,
    header,
    empty,
    attachment,
    onlink,
  }: {
    blocks?: Block[];
    headings?: Heading[];
    projection?: DocumentProjection;
    copyText?: () => string;
    /** The preview of the editor: tighter padding, no table of contents. */
    editing?: boolean;
    header?: Snippet;
    empty?: Snippet;
    attachment?: Snippet;
    onlink: (href: string) => void;
  } = $props();

  let root: HTMLDivElement | undefined = $state();
  let active = $state<string | undefined>();
  let article = $state<DocArticle>();
  const outline = $derived(projection?.view?.headings ?? headings);

  const current = $derived(active ?? outline[0]?.hid);
  const toc = $derived(!editing && outline.length >= 3);

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

  async function go(hid: string): Promise<void> {
    const position = outline.find((heading) => heading.hid === hid)?.position;
    if (projection && position !== undefined) await article?.reveal(position);
    const target = root?.querySelector<HTMLElement>(`[data-hid="${hid}"]`);
    if (target) root?.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' });
    active = hid;
  }

  import './doc-page.css';
</script>

<div data-doc-page class="frame">
  <div data-doc-page class="page" bind:this={root} onscroll={scroll}>
    {#if empty}
      {@render empty()}
    {:else}
      <div data-doc-page class="wrap" class:editing>
        <article data-doc-page>
          {@render header?.()}
          <DocArticle bind:this={article} {blocks} {projection} {copyText} {onlink} />
          {@render attachment?.()}
          {#if editing && !(projection?.view?.count ?? blocks.length)}<span
              data-doc-page
              class="blank">{t('docs.blank')}</span
            >{/if}
        </article>
        {#if toc && tocPanel.open}
          <nav data-doc-page>
            <span data-doc-page class="toc-title">{t('docs.toc')}</span>
            {#each outline as h (h.hid)}
              <div
                data-doc-page
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
      data-doc-page
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
