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
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="blocks" bind:this={root} onclick={click}>
  {#each blocks as block, i (i)}
    {#if block.kind === 'html'}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in render.ts -->
      <div class="md" data-hid={block.hid}>{@html block.html}</div>
    {:else if block.kind === 'rules'}
      <div class="rules" data-hid={block.hid}>
        <div class="rules-head">
          <span class="shield"><Icon name="shield" size={17} stroke={1.9} /></span>
          <span class="rules-title">{block.title}</span>
          <span class="rules-badge" data-tip={t('docs.rules.tip')}>{t('docs.rules.badge')}</span>
        </div>
        <div class="rules-items">
          {#each block.items as item, k (k)}
            <div class="rule">
              <span class="rule-num">{String(k + 1).padStart(2, '0')}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify in render.ts -->
              <span class="md inline">{@html item}</span>
            </div>
          {/each}
        </div>
      </div>
    {:else if block.kind === 'code'}
      <div class="code">
        <div class="code-head">
          <span class="lang">{block.lang}</span>
          <button
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
        <pre>{block.text}</pre>
      </div>
    {:else}
      {#key block.source}
        <div class="diagram"><div class="md-mermaid" data-source={block.source}></div></div>
      {/key}
    {/if}
  {/each}
</div>

<style>
  .blocks {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .md :global(h1),
  .md :global(h2) {
    margin: 14px 0 0;
    font-size: var(--sk-fs-13);
    font-weight: 700;
    color: var(--sk-text-6);
    letter-spacing: -0.005em;
  }

  .md :global(h3),
  .md :global(h4) {
    margin: 4px 0 0;
    font-size: var(--sk-fs-8);
    font-weight: 700;
    color: var(--sk-text-7);
  }

  .md :global(p) {
    margin: 0;
    font-size: var(--sk-fs-8);
    line-height: 1.7;
    color: var(--sk-text-10);
    text-wrap: pretty;
  }

  .md :global(ul),
  .md :global(ol) {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--sk-fs-8);
    line-height: 1.65;
    color: var(--sk-text-10);
  }

  .md :global(ul) {
    list-style: none;
  }

  .md :global(ol) {
    padding-left: 22px;
  }

  .md :global(ul > li) {
    position: relative;
    padding-left: 16px;
    text-wrap: pretty;
  }

  .md :global(ul > li)::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--sk-fill-38);
  }

  /* Inline code: the text a tone lighter on a slightly lighter ground. */
  .md :global(code) {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    color: var(--sk-text-9);
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--sk-code-bg);
  }

  .md :global(strong) {
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .md :global(a) {
    color: var(--sk-link);
    text-decoration: none;
  }

  .md :global(a:hover) {
    color: var(--sk-link-hover);
    text-decoration: underline;
  }

  .md :global(blockquote) {
    margin: 0;
    padding-left: 14px;
    border-left: 2px solid var(--sk-fill-26);
  }

  .md :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--sk-fs-6);
    border-radius: 10px;
    background: var(--sk-fill-11);
    overflow: hidden;
  }

  .md :global(th) {
    text-align: left;
    padding: 10px 14px;
    border-bottom: 1px solid var(--sk-fill-20);
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .md :global(td) {
    padding: 9px 14px;
    border-top: 1px solid var(--sk-fill-6);
    color: var(--sk-text-10);
    line-height: 1.5;
    vertical-align: top;
  }

  .rules {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px 18px;
    border-radius: 12px;
    background: var(--sk-fill-11);
  }

  .rules-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .shield {
    flex: none;
    display: inline-flex;
    color: var(--sk-code);
  }

  .rules-title {
    flex: 1;
    font-size: var(--sk-fs-10);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .rules-badge {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
    cursor: default;
  }

  .rules-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rule {
    display: flex;
    gap: 12px;
    padding: 7px 0;
    border-top: 1px solid var(--sk-fill-6);
    font-size: var(--sk-fs-7);
    line-height: 1.6;
    color: var(--sk-text-7);
  }

  .rule-num {
    flex: none;
    width: 20px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    line-height: 22px;
    color: var(--sk-code);
  }

  .inline {
    min-width: 0;
    text-wrap: pretty;
  }

  .code {
    border-radius: 10px;
    background: var(--sk-fill-11);
    overflow: hidden;
  }

  .code-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 6px 0 14px;
    border-bottom: 1px solid var(--sk-fill-6);
  }

  .lang {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-23);
  }

  .copy {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-21);
    cursor: pointer;
  }

  .copy:hover {
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
  }

  pre {
    margin: 0;
    padding: 12px 14px 14px;
    overflow-x: auto;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    line-height: 1.65;
    color: var(--sk-text-7);
  }

  .diagram {
    display: flex;
    justify-content: center;
    padding: 22px 16px;
    border-radius: 10px;
    background: var(--sk-fill-11);
    overflow-x: auto;
  }
</style>
