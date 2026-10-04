<script lang="ts">
  import { Checkbox, RadioCards, TextField } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';

  let search = $state('');
  let projectName = $state('');
  let checks = $state({ a: true, b: false, c: false });
  let mode = $state<'ask' | 'auto' | 'full'>('auto');
</script>

<InventorySection
  title="07 · Поля, чекбоксы, радио"
  note="Поле и селект выглядят одинаково на любом фоне и ставятся только в карточку или модалку. Открытый список всегда светлее поверхности и с тенью. Чекбоксы тёмные, без акцента. Радио-карточка — для выбора с пояснением; рискованный вариант подсвечен жёлтым."
>
  <div data-inventory class="grid2">
    <div data-inventory class="panel column">
      <TextField search placeholder="Поиск по названию или пути" bind:value={search} />
      <TextField label="Название проекта" placeholder="shop-api" bind:value={projectName} />
      <div data-inventory class="checks">
        <Checkbox bind:checked={checks.a} label="Юнит-тесты на матрицу прав" />
        <Checkbox bind:checked={checks.b} label="Попытка без прав — 403 и запись в журнал" />
        <Checkbox bind:checked={checks.c} label="Проверка в сервисном слое" />
      </div>
    </div>
    <div data-inventory class="panel tight">
      <RadioCards
        bind:value={mode}
        label="Режим прав"
        options={[
          { value: 'ask', label: 'Спрашивать', note: 'Разрешение на каждую команду и запись.' },
          {
            value: 'auto',
            label: 'Авто в пределах задачи',
            note: 'Свободно в своей ветке, спрашивает про всё за её пределами.',
          },
          {
            value: 'full',
            label: 'Полный доступ',
            note: 'Любые команды без вопросов — только для доверенных проектов.',
            warn: true,
          },
        ]}
      />
    </div>
  </div>
</InventorySection>
