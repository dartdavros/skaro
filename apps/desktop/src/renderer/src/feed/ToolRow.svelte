<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { imageUrl } from './format';

  /** "⚙ server.tool args ✓" with input and result inside; screenshots always visible. */
  let { row, waiting = false }: { row: Extract<FeedRow, { type: 'tool' }>; waiting?: boolean } =
    $props();

  const feed = useFeed();
  const item = $derived(row.item);
  let open = $state(false);
  const name = $derived(item.server ? `${item.server}.${item.name}` : item.name);
  const hint = $derived(summary(item.input));
  const images = $derived(item.images ?? []);

  /** A short hint from the input: the first string value. */
  function summary(input?: string): string {
    if (!input) return '';
    try {
      const value = JSON.parse(input) as unknown;
      if (value && typeof value === 'object') {
        const first = Object.values(value).find(
          (v) => typeof v === 'string' || typeof v === 'number',
        );
        return first === undefined ? '' : String(first);
      }
      return String(value);
    } catch {
      return input.slice(0, 80);
    }
  }

  function pretty(text?: string): string {
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
</script>

<div class="fd-block gap6">
  <button
    type="button"
    class="fd-row"
    class:clickable={!!(item.input || item.output)}
    data-tip={t('feed.tool.tip')}
    onclick={() => (open = !open)}
  >
    <span class="fd-glyph">⚙</span>
    <span class="fd-main"
      >{name}{#if hint}<span class="dim hint">{hint}</span>{/if}</span
    >
    {#if waiting || item.status === 'queued'}
      <span class="fd-wait-dot"></span>
    {:else if item.status === 'running'}
      <span class="fd-meta"><span class="fd-pulse"></span></span>
    {:else if item.status === 'failed'}
      <span class="fd-meta bad">✗</span>
    {:else if item.status === 'declined'}
      <span class="fd-meta">{t('feed.cmd.declined')}</span>
    {:else if item.status === 'interrupted'}
      <span class="fd-meta">{t('feed.cmd.interrupted')}</span>
    {:else}
      <span class="fd-meta ok">✓</span>
    {/if}
  </button>
  {#if images.length === 1}
    <div style="margin-left: 21px">
      <button
        type="button"
        class="fd-image-frame"
        data-tip={t('feed.image.open')}
        onclick={() => feed.viewImage(imageUrl(images[0]!))}
      >
        <img src={imageUrl(images[0]!)} alt="" />
      </button>
    </div>
  {:else if images.length > 1}
    <div class="fd-image-strip">
      {#each images.slice(0, 3) as image, i (image.id + i)}
        <button type="button" class="strip-btn" onclick={() => feed.viewImage(imageUrl(image))}>
          <img src={imageUrl(image)} alt="" />
          {#if i === 2 && images.length > 3}<span
              class="more"
              data-tip={t('feed.image.more', { n: images.length - 2 })}>+{images.length - 3}</span
            >{/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if open && (item.input || item.output)}
    <div class="fd-tool-grid">
      <div class="fd-tool-box">
        <span class="fd-label">{t('feed.tool.input')}</span>
        <pre>{pretty(item.input)}</pre>
      </div>
      <div class="fd-tool-box">
        <span class="fd-label">{t('feed.tool.output')}</span>
        <pre>{pretty(item.output)}</pre>
      </div>
    </div>
  {/if}
</div>

<style>
  .hint {
    margin-left: 8px;
  }

  .strip-btn {
    position: relative;
    width: 72px;
    height: 72px;
    padding: 0;
    border: none;
    border-radius: 8px;
    overflow: hidden;
    cursor: zoom-in;
    background: none;
  }

  .strip-btn img {
    width: 72px;
    height: 72px;
    object-fit: cover;
    display: block;
  }

  .more {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    font-family: var(--sk-mono);
    font-size: 13px;
    font-weight: 600;
    color: #ededed;
  }
</style>
