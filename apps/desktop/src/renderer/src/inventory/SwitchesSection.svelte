<script lang="ts">
  import { EffortSlider, Segmented, Toggle } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';

  let view = $state<'board' | 'list'>('board');
  let effort = $state<'low' | 'medium' | 'high'>('medium');
  let layout = $state<'grid' | 'list'>('grid');
  let sliderValue = $state('xhigh');
  let planFirst = $state(false);
</script>

<InventorySection
  title="05 · Переключатель"
  note="Один вид для всех взаимоисключающих выборов: вид, сортировка, архив, усилие, изоляция. Подложка почти чёрная, активный пункт — цвета основного фона."
>
  <div data-inventory class="panel row wrap">
    <Segmented
      bind:value={view}
      options={[
        { value: 'board', label: 'Доска' },
        { value: 'list', label: 'Список' },
      ]}
    />
    <Segmented
      bind:value={effort}
      options={[
        { value: 'low', label: 'Низкое' },
        { value: 'medium', label: 'Среднее' },
        { value: 'high', label: 'Высокое' },
      ]}
    />
    <Segmented
      bind:value={layout}
      options={[
        { value: 'grid', label: 'Сетка', icon: 'grid' },
        { value: 'list', label: 'Список', icon: 'list' },
      ]}
    />
  </div>
  <div data-inventory class="panel column narrow">
    <span data-inventory class="sk-label">Ползунок усилия</span>
    <EffortSlider
      bind:value={sliderValue}
      defaultValue="medium"
      levels={[
        { id: 'minimal', label: 'Минимальное' },
        { id: 'low', label: 'Низкое' },
        { id: 'medium', label: 'Среднее' },
        { id: 'high', label: 'Высокое' },
        { id: 'xhigh', label: 'Очень высокое' },
      ]}
      tips={{ xhigh: 'Долгие рассуждения для сложных задач', medium: 'Значение по умолчанию' }}
    />
    <span data-inventory class="note"
      >Число шагов зависит от модели (2–5). Тянуть, кликать по дорожке или стрелками с клавиатуры;
      справа — «Вернуть по умолчанию».</span
    >
  </div>
  <div data-inventory class="panel column narrow">
    <span data-inventory class="sk-label">Тумблер вкл/выкл</span>
    <Toggle bind:checked={planFirst} label="Сначала план" />
    <span data-inventory class="note"
      >Одиночная настройка «включено / выключено»: 32×18, включено — синий.</span
    >
  </div>
</InventorySection>
