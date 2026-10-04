<script lang="ts">
  import { StatusDot } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';
</script>

<InventorySection
  title="03 · Индикаторы состояния"
  note="Точка без текста, смысл — в подсказке. Работает — серая мигающая. Требует внимания (ответ, ревью, завершено) — синяя статичная. Ошибка — красная. Заблокировано — замок. Во вкладках — никаких чисел."
>
  <div data-inventory class="row wrap">
    <div data-inventory class="chip-card" data-tip="Агент работает">
      <StatusDot state="working" tip="" /><span data-inventory>В работе</span>
    </div>
    <div data-inventory class="chip-card" data-tip="Нужен ответ / на ревью / завершено">
      <StatusDot state="attention" tip="" /><span data-inventory>Требует внимания</span>
    </div>
    <div data-inventory class="chip-card" data-tip="Запуск упал">
      <StatusDot state="error" tip="" /><span data-inventory>Ошибка</span>
    </div>
    <div data-inventory class="chip-card" data-tip="Ждёт завершения зависимостей">
      <StatusDot state="blocked" tip="" /><span data-inventory>Заблокирована</span>
    </div>
    <div data-inventory class="chip-card counts" data-tip="На карточке проекта: точка + число">
      <span data-inventory class="count" data-tip="В работе: 2"
        ><StatusDot state="working" tip="" />2</span
      >
      <span data-inventory class="count" data-tip="Нужен ответ: 1"
        ><StatusDot state="attention" tip="" />1</span
      >
      <span data-inventory class="count" data-tip="Ошибка: 1"
        ><StatusDot state="error" tip="" />1</span
      >
    </div>
  </div>
</InventorySection>
