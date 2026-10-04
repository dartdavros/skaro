<script lang="ts">
  import { TaskCard } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';
  import { taskCards } from './data';

  let cardsLog = $state('Клик по карточке — открыть · чекбокс — выделить');
  let cards = $state(taskCards());
  const selectedCount = $derived(cards.filter((c) => c.selected).length);
</script>

<InventorySection
  title="09 · Карточки задач"
  note="Все карточки одинаковые, отличается только индикатор справа сверху. Сверху название, ниже этап, внизу время слева и лого агента справа. Клик открывает задачу, выделение — только чекбоксом (появляется при наведении или выборе). Статус колонки на карточке не дублируется."
>
  <div data-inventory class="cards">
    {#each cards as card, i (card.title)}
      <TaskCard
        title={card.title}
        stage={card.stage}
        time={card.time}
        agent={card.agent}
        state={card.state}
        stateTip={card.tip}
        bind:selected={cards[i]!.selected}
        onopen={() => (cardsLog = `Открыта задача «${card.title}»`)}
      />
    {/each}
  </div>
  <span data-inventory class="log">{selectedCount ? `Выделено: ${selectedCount}` : cardsLog}</span>
</InventorySection>
