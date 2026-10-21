<script lang="ts">
  import type { C4Model, C4State, C4ViewKind } from '@skaro/core/c4-view';
  import C4Preview from './C4Preview.svelte';
  import C4List from './C4List.svelte';
  import C4GalleryToolbar from './C4GalleryToolbar.svelte';
  import './i18n';
  let { model, onopen }: { model: C4Model; onopen: (viewId: string) => void } = $props();
  let view = $state(localStorage.getItem('skaro.c4.gallery') === 'list' ? 'list' : 'grid');
  let kinds = $state<C4ViewKind[]>([]);
  let states = $state<C4State[]>([]);
  const views = $derived(
    model.views.filter(
      (item) =>
        (!kinds.length || kinds.includes(item.kind)) &&
        (!states.length || states.includes(item.state)),
    ),
  );
</script>

<div class="c4-gallery" data-c4-gallery>
  <C4GalleryToolbar
    views={model.views}
    bind:kinds
    bind:states
    {view}
    onviewchange={(next) => {
      view = next;
      localStorage.setItem('skaro.c4.gallery', next);
    }}
  />
  {#if view === 'list'}
    <C4List {views} {onopen} />
  {:else}
    <div class="previews">
      {#each views as view (view.id)}
        <C4Preview {model} {view} onopen={() => onopen(view.id)} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .c4-gallery {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    container-type: inline-size;
    padding: 18px;
    background: var(--sk-bg);
    --c4-preview-height: 180px;
  }
  .previews {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 18px;
  }
  @container (min-width: 960px) {
    .previews {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
