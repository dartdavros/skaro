<script lang="ts">
  import PinnedBackground from './PinnedBackground.svelte';
  import PinnedPlan from './PinnedPlan.svelte';
  import PendingActions from './PendingActions.svelte';

  import type { PinnedZoneProps } from './pinned-zone-props';
  import { createPinnedZoneController } from './pinned-zone-controller.svelte';
  let { timeline, mergeMessage }: PinnedZoneProps = $props();
  const state = createPinnedZoneController({
    get timeline() {
      return timeline;
    },
  });
  import './pinned-zone.css';
</script>

<!-- Cards above the input keep the input's column, not the whole pane. -->
<div class="pinned">
  <PinnedBackground {state} />
  <PinnedPlan {state} />
  <PendingActions {timeline} {mergeMessage} />
</div>

<style>
  .pinned {
    width: 100%;
    max-width: 744px;
    box-sizing: border-box;
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pinned:not(:has(*)) {
    display: none;
  }
</style>
