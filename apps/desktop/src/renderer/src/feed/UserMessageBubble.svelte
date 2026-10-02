<script lang="ts">
  import { imageUrl } from './format';
  import type { UserMessageController } from './user-message-controller.svelte';
  let { state }: { state: UserMessageController } = $props();
</script>

<div
  data-user-message
  class="fd-bubble"
  class:queued={state.queued}
  class:with-images={state.p.row.images.length > 0}
>
  {#if state.p.row.images.length}
    <div data-user-message class="thumbs">
      {#each state.p.row.images as image (image.id)}
        <button
          data-user-message
          type="button"
          class="thumb-btn"
          onclick={() => state.feed.viewImage(imageUrl(image.image))}
        >
          <img data-user-message class="fd-thumb" src={imageUrl(image.image)} alt="" />
        </button>
      {/each}
    </div>
    <span data-user-message>{state.p.row.item.text}</span>
  {:else if state.importLines}
    <span data-user-message class="import"
      ><span data-user-message>{state.importLines.head}</span
      >{#each state.importLines.sources as source, i (i)}<span
          data-user-message
          class="import-source">{source}</span
        >{/each}</span
    >
  {:else}
    {state.p.row.item.text}
  {/if}
</div>
