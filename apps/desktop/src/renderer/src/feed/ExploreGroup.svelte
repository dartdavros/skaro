<script lang="ts">
  import { exploreCounts, type FeedRow } from '@skaro/timeline';
  import { t, tn } from '@skaro/ui';
  import Chevron from './Chevron.svelte';
  import { useFeed } from './context.svelte';
  import { displayPath, hostOf, imageUrl } from './format';

  /** "Прочитал 6 файлов · искал «requireRole» · открыл 1 страницу" with the list inside. */
  let { row }: { row: Extract<FeedRow, { type: 'explore' }> } = $props();

  const feed = useFeed();
  let open = $state(false);
  const counts = $derived(exploreCounts(row.items));
  const running = $derived(row.items.some((i) => i.status === 'running'));

  const parts = $derived.by(() => {
    const out: { text: string; code?: string }[] = [];
    if (counts.read) out.push({ text: tn('feed.read', counts.read) });
    if (counts.images) out.push({ text: tn('feed.images', counts.images) });
    if (counts.list) out.push({ text: tn('feed.list', counts.list) });
    for (const q of counts.search.slice(0, 2)) out.push({ text: t('feed.searched'), code: q });
    if (counts.search.length > 2) out.push({ text: `+${counts.search.length - 2}` });
    if (counts.pages) out.push({ text: tn('feed.pages', counts.pages) });
    for (const q of counts.web.slice(0, 1)) out.push({ text: t('feed.searchedWeb'), code: q });
    // Sentence case: the first part starts with a capital letter.
    if (out[0]) out[0] = { ...out[0], text: out[0].text[0]!.toUpperCase() + out[0].text.slice(1) };
    return out;
  });

  const rows = $derived(
    row.items.map((item) => {
      if (item.op === 'search')
        return {
          id: item.id,
          text: t('feed.search.row', { q: item.target }),
          meta: item.detail ?? '',
          link: false,
          tip: t('feed.searchTip'),
        };
      if (item.op === 'web')
        return {
          id: item.id,
          text: t('feed.web.row', { q: item.target }),
          meta: item.detail ?? '',
          link: false,
          tip: '',
        };
      if (item.op === 'fetch')
        return {
          id: item.id,
          text: item.target.replace(/^https?:\/\//, ''),
          meta: hostOf(item.target),
          link: true,
          url: item.target,
          tip: t('feed.openPage'),
        };
      const path = displayPath(item.target, feed.cwd);
      return {
        id: item.id,
        text: item.op === 'list' ? t('feed.list.row', { path }) : path,
        meta: item.image?.width
          ? `${item.image.width}×${item.image.height}`
          : (item.detail ?? (item.op === 'read' ? t('feed.whole') : '')),
        link: item.op === 'read',
        path: item.target,
        image: item.image,
        tip: t('feed.openFile'),
      };
    }),
  );
</script>

<div class="fd-block gap4">
  <button
    type="button"
    class="fd-fold"
    data-tip={t('feed.explore.tip')}
    onclick={() => (open = !open)}
  >
    {#if running}<span class="fd-pulse"></span>{:else}<Chevron {open} />{/if}
    <span
      >{#each parts as part, i (i)}{#if i}&nbsp;·
        {/if}{part.text}{#if part.code}
          «<code>{part.code}</code>»{/if}{/each}</span
    >
  </button>
  {#if open}
    <div class="fd-sublist">
      {#each rows as r (r.id)}
        <button
          type="button"
          class="fd-subrow"
          class:link={r.link}
          data-tip={r.tip || undefined}
          onclick={() => {
            if ('url' in r && r.url) feed.openExternal(r.url);
            else if ('image' in r && r.image) feed.viewImage(imageUrl(r.image));
            else if ('path' in r && r.path && r.link) feed.openPath(r.path);
          }}
        >
          {#if 'image' in r && r.image}<img class="mini" src={imageUrl(r.image)} alt="" />{/if}
          <span class="main">{r.text}</span>
          {#if r.meta}<span class="meta">{r.meta}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .mini {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: cover;
  }
</style>
