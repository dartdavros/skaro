<script lang="ts">
  import { Banner, Button, Progress } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';

  let { onmodal, onconfirm }: { onmodal: () => void; onconfirm: () => void } = $props();

  let banners = $state({ warn: true, err: true });
  let progress = $state(3);
</script>

<InventorySection
  title="11 · Обратная связь"
  note="Тултип — чёрный, без обводки, ширина по содержимому, не выходит за окно. Баннер — текст одного цвета, соответствующего типу. Прогресс — только оттенки серого. Модалка — для любых действий с задачами (удаление, перенос, архив)."
>
  <div data-inventory class="panel column">
    <div data-inventory class="row wrap">
      <span data-inventory class="pill" data-tip="Короткая подсказка">Наведи — короткий тултип</span
      >
      <span
        data-inventory
        class="pill"
        data-tip="Длинная подсказка переносится на несколько строк, но не шире 260 пикселей и никогда не выходит за край окна"
        >Наведи — длинный тултип</span
      >
      <Button size="sm" onclick={onmodal}>Модалка выбора агента</Button>
      <Button size="sm" onclick={onconfirm}>Модалка подтверждения</Button>
      <Button size="sm" variant="ghost" onclick={() => (banners = { warn: true, err: true })}
        >Вернуть баннеры</Button
      >
    </div>
    {#if banners.warn}
      <Banner
        kind="warning"
        title="Claude Code не найден."
        text="Установите агента или войдите в аккаунт."
        action="Открыть параметры"
        onclose={() => (banners.warn = false)}
      />
    {/if}
    {#if banners.err}
      <Banner
        kind="error"
        title="Запуск T-014 упал."
        text="Процесс агента завершился с кодом 1."
        action="Открыть лог"
        onclose={() => (banners.err = false)}
      />
    {/if}
    <div
      data-inventory
      class="progress"
      data-tip="Кликни — шаг прогресса"
      role="button"
      tabindex="0"
      onclick={() => (progress = progress >= 6 ? 0 : progress + 1)}
      onkeydown={() => undefined}
    >
      <Progress id="M02" label="Платежи" done={progress} total={6} />
    </div>
  </div>
</InventorySection>
