<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { drawMermaid } from '../feed/markdown';
  import type { Block } from './render';

  /** The text of a document in the look of the Documents mockup. */
  let {
    blocks,
    onlink,
  }: {
    blocks: Block[];
    /** A link was clicked: an ADR, another document or a web address. */
    onlink: (href: string) => void;
  } = $props();

  let root: HTMLElement | undefined = $state();
  let copied = $state<number | undefined>();

  $effect(() => {
    void blocks;
    if (root) void drawMermaid(root);
  });

  function copy(i: number, text: string): void {
    void navigator.clipboard.writeText(text);
    copied = i;
    setTimeout(() => copied === i && (copied = undefined), 1400);
  }

  function click(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest<HTMLElement>('a[data-href]');
    if (!a) return;
    e.preventDefault();
    onlink(a.dataset['href'] ?? '');
  }

  import './doc-article.css';
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div data-doc-article class="blocks" bind:this={root} onclick={click}>
  {#each blocks as block, i (i)}
    {#if block.kind === 'html'}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in render.ts -->
      <div data-doc-article class="md" data-hid={block.hid}>{@html block.html}</div>
    {:else if block.kind === 'rules'}
      <div data-doc-article class="rules" data-hid={block.hid}>
        <div data-doc-article class="rules-head">
          <span data-doc-article class="shield"><Icon name="shield" size={17} stroke={1.9} /></span>
          <span data-doc-article class="rules-title">{block.title}</span>
          <span data-doc-article class="rules-badge" data-tip={t('docs.rules.tip')}
            >{t('docs.rules.badge')}</span
          >
        </div>
        <div data-doc-article class="rules-items">
          {#each block.items as item, k (k)}
            <div data-doc-article class="rule">
              <span data-doc-article class="rule-num">{String(k + 1).padStart(2, '0')}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in render.ts -->
              <span data-doc-article class="md inline">{@html item}</span>
            </div>
          {/each}
        </div>
      </div>
    {:else if block.kind === 'code'}
      <div data-doc-article class="code">
        <div data-doc-article class="code-head">
          <span data-doc-article class="lang">{block.lang}</span>
          <button
            data-doc-article
            type="button"
            class="copy"
            data-tip={copied === i ? t('docs.copied') : t('docs.copy')}
            onclick={() => copy(i, block.text)}
            ><Icon
              name={copied === i ? 'check' : 'copy'}
              size={13}
              stroke={copied === i ? 2.2 : 1.9}
            /></button
          >
        </div>
        <pre data-doc-article>{block.text}</pre>
      </div>
    {:else}
      {#key block.source}
        <div data-doc-article class="diagram">
          <div data-doc-article class="md-mermaid" data-source={block.source}></div>
        </div>
      {/key}
    {/if}
  {/each}
</div>
