<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import Chevron from './Chevron.svelte';

  /** What the user answered, after the card closed (mockups 3g, 9h). */
  let { row }: { row: Extract<FeedRow, { type: 'decision' }> } = $props();

  let open = $state(false);
  const { interaction, answer } = $derived(row.item);

  const pairs = $derived.by(() => {
    if (interaction.kind !== 'question' || answer.kind !== 'question') return [];
    return interaction.questions.map((q) => ({
      header: q.header,
      text: q.text,
      answer: (answer.answers[q.id] ?? []).join(', '),
    }));
  });

  const text = $derived.by(() => {
    if (interaction.kind === 'question') {
      const values = pairs.map((p) => p.answer).filter(Boolean);
      return values.length > 1
        ? t('card.question.answeredMany', { a: values.join(' · ') })
        : t('card.question.answered', { a: values[0] ?? '' });
    }
    if (answer.kind === 'plan_approval') {
      return answer.approve ? t('decision.plan.approved') : t('decision.plan.rework');
    }
    if (answer.kind === 'form') {
      return answer.action === 'accept' ? t('decision.form.sent') : t('decision.form.declined');
    }
    if (answer.kind === 'login') {
      return answer.action === 'done' ? t('decision.login.done') : t('decision.login.skipped');
    }
    if (answer.kind === 'approval') {
      return answer.choice === 'deny' ? t('decision.denied') : t('decision.allowed');
    }
    return '';
  });
</script>

<div class="fd-block gap6">
  {#if pairs.length}
    <button
      type="button"
      class="fd-done-line clickable"
      data-tip={t('card.question.pairsTip')}
      onclick={() => (open = !open)}
    >
      <Icon name="check" size={13} stroke={2.4} />
      <span class="text">{text}</span>
      <Chevron {open} color="#6f6f6f" />
    </button>
    {#if open}
      <div class="pairs">
        {#each pairs as pair, i (i)}
          <div class="pair">
            <span class="fd-label">{pair.header}</span>
            <span class="q">{pair.text}</span>
            <span class="a">{pair.answer}</span>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="fd-done-line">
      <Icon name="check" size={13} stroke={2.4} />
      <span class="text">{text}</span>
    </div>
  {/if}
</div>

<style>
  .text {
    flex: 1;
    min-width: 0;
  }

  .pairs {
    margin-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 6px;
  }

  .pair {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .q {
    font-size: 12.5px;
    line-height: 1.5;
    color: #a6a6a6;
  }

  .a {
    font-size: 12.5px;
    font-weight: 600;
    color: #d5d5d5;
  }
</style>
