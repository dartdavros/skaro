<script lang="ts">
  import PinnedBackground from './PinnedBackground.svelte';
  import PinnedPlan from './PinnedPlan.svelte';

  import type { PinnedZoneProps } from './pinned-zone-props';
  import { createPinnedZoneController } from './pinned-zone-controller.svelte';
  let { timeline }: PinnedZoneProps = $props();
  const state = createPinnedZoneController({
    get timeline() {
      return timeline;
    },
  });
  import './pinned-zone.css';
</script>

<PinnedBackground {state} />
<PinnedPlan {state} />
