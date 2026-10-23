<script lang="ts">
  import PinnedBackground from './PinnedBackground.svelte';
  import PinnedPlan from './PinnedPlan.svelte';
  import QuestionCard from './QuestionCard.svelte';

  import type { PinnedZoneProps } from './pinned-zone-props';
  import { createPinnedZoneController } from './pinned-zone-controller.svelte';
  let { timeline }: PinnedZoneProps = $props();
  const state = createPinnedZoneController({
    get timeline() {
      return timeline;
    },
  });
  import './pinned-zone.css';
  const questions = $derived(
    timeline.interactions.filter((interaction) => interaction.kind === 'question'),
  );
</script>

{#if questions.length}<div data-pinned-zone class="questions">
    {#each questions as interaction (interaction.id)}<QuestionCard {interaction} />{/each}
  </div>{/if}
<PinnedBackground {state} />
<PinnedPlan {state} />

<style>
  .questions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 45vh;
    overflow-y: auto;
  }
  .questions :global(.question) {
    flex: none;
  }
</style>
