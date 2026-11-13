<script lang="ts">
  import { Button, Modal, t, tn } from '@skaro/ui';
  import { Clock, RotateCw, X } from '@lucide/svelte';
  import { decisions } from './decisions.svelte';
  import DecisionCard from './DecisionCard.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import type { DecisionOrigin } from '../../../shared/project-decisions';
  import '../feed/feed.css';
  import './i18n';
  let { onopen }: { onopen: (origin: DecisionOrigin, importId?: string) => void } = $props();
  const primary = $derived(
    decisions.cards.find(
      (card) =>
        card.status === 'pending' &&
        card.entry?.kind === 'interaction' &&
        card.entry.interaction.kind === 'approval',
    )?.entry?.id,
  );
  function close(value: boolean) {
    decisions.open = value;
    if (!value)
      queueMicrotask(() =>
        document.querySelector<HTMLButtonElement>('[data-decision-button]')?.focus(),
      );
  }
</script>

{#if decisions.project}
  <Modal
    projectScoped
    bind:open={() => decisions.open, close}
    title={t('decisions.title')}
    subtitle={`${decisions.project.name} · ${tn('decisions.waiting', decisions.count)}`}
    width={720}
  >
    <div class="decision-list" data-decision-list aria-busy={decisions.loading}>
      {#if decisions.loading}<div class="center">
          <LoadingIndicator /><span>{t('decisions.loading')}</span>
        </div>
      {:else if decisions.error}<div class="center">
          <span>{t('decisions.loadError')}</span><Button onclick={() => void decisions.refresh()}
            ><RotateCw size={16} />{t('decisions.retry')}</Button
          >
        </div>
      {:else if !decisions.cards.length}<div class="center">{t('decisions.empty')}</div>
      {:else}{#each decisions.cards as card (card.entry!.id)}<DecisionCard
            {card}
            primary={card.entry!.id === primary}
            {onopen}
          />{/each}{/if}
    </div>
    {#snippet footer()}<Button onclick={() => close(false)}
        >{#if decisions.count}<Clock size={16} />{:else}<X size={16} />{/if}{t(
          decisions.count ? 'decisions.later' : 'decisions.close',
        )}</Button
      >{/snippet}
  </Modal>
{/if}

<style>
  .decision-list {
    height: min(480px, calc(100dvh - 205px));
    min-height: min(280px, calc(100dvh - 205px));
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 3px;
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-6);
  }
</style>
