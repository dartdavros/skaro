<script lang="ts">
  import { ConfirmDialog, t } from '@skaro/ui';
  import AgentModal from '../inventory/AgentModal.svelte';
  import ButtonsSection from '../inventory/ButtonsSection.svelte';
  import CardsSection from '../inventory/CardsSection.svelte';
  import ColorsSection from '../inventory/ColorsSection.svelte';
  import FeedbackSection from '../inventory/FeedbackSection.svelte';
  import FieldsSection from '../inventory/FieldsSection.svelte';
  import MenusSection from '../inventory/MenusSection.svelte';
  import NavigationSection from '../inventory/NavigationSection.svelte';
  import StatusSection from '../inventory/StatusSection.svelte';
  import SwitchesSection from '../inventory/SwitchesSection.svelte';
  import TypographySection from '../inventory/TypographySection.svelte';
  import '../inventory/inventory.css';
  import '../inventory/inventory-sections.css';

  /** The UI inventory rebuilt from Svelte components, to check against docs/mockups/UI Inventory. */

  let modal = $state(false);
  let confirm = $state(false);
</script>

<div data-inventory class="inventory">
  <div data-inventory class="intro">
    <h1 data-inventory class="sk-title">{t('inventory.title')}</h1>
    <p data-inventory class="lead">{t('inventory.subtitle')}</p>
  </div>

  <ColorsSection />
  <TypographySection />
  <StatusSection />
  <ButtonsSection />
  <SwitchesSection />
  <MenusSection onconfirm={() => (confirm = true)} />
  <FieldsSection />
  <NavigationSection />
  <CardsSection />
  <FeedbackSection onmodal={() => (modal = true)} onconfirm={() => (confirm = true)} />
</div>

<AgentModal bind:open={modal} />

<ConfirmDialog
  bind:open={confirm}
  title="Удалить 2 задачи?"
  text="Задачи и их ветки будут удалены. Это действие нельзя отменить."
  action="Удалить"
  onconfirm={() => undefined}
/>
