<script lang="ts">
  import InventorySection from './InventorySection.svelte';
</script>

<InventorySection
  title="02 · Типографика"
  note="Nunito Sans — интерфейс, JetBrains Mono — ID, пути, ветки, числа. Чистый белый не используется: максимум #e0e0e0."
>
  <div data-inventory class="type">
    <div data-inventory class="type-row">
      <span data-inventory class="spec">Заголовок · 23/700</span><span
        data-inventory
        class="sk-title">Проекты</span
      >
    </div>
    <div data-inventory class="type-row">
      <span data-inventory class="spec">Название · 14.5/600</span><span
        data-inventory
        class="sk-name">Роли и доступы админки</span
      >
    </div>
    <div data-inventory class="type-row">
      <span data-inventory class="spec">Текст · 13/400</span><span data-inventory class="sk-text"
        >Проверка прав в сервисном слое, а не только в UI.</span
      >
    </div>
    <div data-inventory class="type-row">
      <span data-inventory class="spec">Вторичный · 12/400</span><span
        data-inventory
        class="sk-secondary">3 часа назад</span
      >
    </div>
    <div data-inventory class="type-row">
      <span data-inventory class="spec">Метка раздела · 11/600</span><span
        data-inventory
        class="sk-label">Критерии приёмки</span
      >
    </div>
    <div data-inventory class="type-row last">
      <span data-inventory class="spec">Моно · 12/400</span>
      <span data-inventory class="mono-row sk-mono">
        <span data-inventory style="color: var(--sk-text-secondary)">T-020</span>
        <code data-inventory data-tip="Некликабельный фрагмент кода — коралл">npm run test</code>
        <a data-inventory href="#top" data-tip="Ссылка на файл — светлый синий"
          >src/auth/policy.ts</a
        >
      </span>
    </div>
  </div>
</InventorySection>
