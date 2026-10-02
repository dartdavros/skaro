<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import ActionIcon from './ActionIcon.svelte';
  import { useFeed } from './context.svelte';
  import { displayPath, hostOf, imageUrl } from './format';

  /** File reads and searches inside the shared action group, without a second fold. */
  let { row }: { row: Extract<FeedRow, { type: 'explore' }> } = $props();

  const feed = useFeed();

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

<div class="fd-block" id={`explore:${row.id}-list`}>
  {#each rows as r, i (r.id)}
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
      <ActionIcon kind={row.items[i]!.op} />
      {#if 'image' in r && r.image}<img class="mini" src={imageUrl(r.image)} alt="" />{/if}
      <span class="main">{r.text}</span>
      {#if r.meta}<span class="meta">{r.meta}</span>{/if}
    </button>
  {/each}
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
