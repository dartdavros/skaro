<script lang="ts">
  import { Button, Icon, IconButton } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';

  let bumps = $state(0);
</script>

<InventorySection
  title="04 · Кнопки"
  note="Главная — одна на экран, синяя с белым текстом. Вторичная — серая поверхность. Иконки-кнопки — фон только при наведении. Круглые — только в поле ввода."
>
  <div data-inventory class="panel row wrap">
    <Button variant="primary" data-tip="Главное действие экрана" onclick={() => bumps++}
      ><Icon name="plus" size={15} stroke={2.6} />Новая задача</Button
    >
    <Button data-tip="Вторичное действие" onclick={() => bumps++}>Бриф</Button>
    <Button variant="danger" data-tip="Разрушительное действие — только в модалке">Удалить</Button>
    <span data-inventory class="vsep"></span>
    <IconButton tip="Иконка-кнопка"><Icon name="filters" size={16} /></IconButton>
    <IconButton tip="Скопировать" tone="muted"
      ><Icon name="copy" size={14} stroke={1.9} /></IconButton
    >
    <span data-inventory class="vsep"></span>
    <IconButton variant="round" tip="Прикрепить — круглый фон при наведении"
      ><Icon name="plus" size={15} stroke={2.6} /></IconButton
    >
    <IconButton variant="send" tip="Отправить"
      ><Icon name="send" size={14} stroke={2.3} /></IconButton
    >
    <IconButton variant="round" tone="bright" tip="Остановить агента">
      <svg data-inventory width="16" height="16" viewBox="0 0 16 16"
        ><circle
          data-inventory
          cx="8"
          cy="8"
          r="7"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        /><rect
          data-inventory
          x="5.25"
          y="5.25"
          width="5.5"
          height="5.5"
          rx="1"
          fill="currentColor"
        /></svg
      >
    </IconButton>
    <IconButton variant="float" size={34} tip="К концу диалога — появляется при прокрутке вверх"
      ><Icon name="arrowDown" size={16} stroke={2.2} /></IconButton
    >
    <span data-inventory class="log">{bumps ? `нажато: ${bumps}` : ''}</span>
  </div>
</InventorySection>
