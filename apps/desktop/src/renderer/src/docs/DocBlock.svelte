<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { drawMermaid } from '../feed/markdown';
  import { sanitizeBlock, type Block } from './render';
  let { value }: { value: Block } = $props();
  const block = $derived(sanitizeBlock(value));
  let copied = $state(false);
  let root = $state<HTMLDivElement>();
  $effect(() => {
    void block;
    if (root) void drawMermaid(root);
  });
  function copy(text: string): void {
    void navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
  import './doc-article.css';
</script>

<div bind:this={root} style="display: flex; flex-direction: column; min-width: 0">
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
          data-tip={copied ? t('docs.copied') : t('docs.copy')}
          onclick={() => copy(block.text)}
          ><Icon name={copied ? 'check' : 'copy'} size={13} stroke={copied ? 2.2 : 1.9} /></button
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
</div>
