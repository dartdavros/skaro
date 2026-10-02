<script lang="ts">
  import { ActionMenu, AgentLogo, FilterMenu, Select, StatusDot } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';
  import { models, statuses } from './data';

  let { onconfirm }: { onconfirm: () => void } = $props();

  let statusFilter = $state<string[]>(['need']);
  let agentFilter = $state<string[]>([]);
  let model = $state('opus');
</script>

<InventorySection
  title="06 · Выпадающие списки"
  note="Только кастомные, не системные селекты. Фильтр — множественный выбор с цветным маркером статуса или логотипом агента. Селект модели — одиночный, сверху самые сильные, с пояснением. Меню действий — список с разделителем перед опасным пунктом. Закрываются кликом снаружи."
>
  <div data-inventory class="panel row menus">
    <FilterMenu label="Статус" options={statuses} bind:selected={statusFilter}>
      {#snippet marker(value)}
        <StatusDot state={statuses.find((s) => s.value === value)?.dot ?? 'none'} tip="" />
      {/snippet}
    </FilterMenu>
    <FilterMenu
      label="Агент"
      width={196}
      options={[
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'codex', label: 'Codex' },
      ]}
      bind:selected={agentFilter}
    >
      {#snippet marker(value)}
        <AgentLogo agent={value === 'codex' ? 'codex' : 'claude-code'} size={15} />
      {/snippet}
    </FilterMenu>
    <Select options={models} bind:value={model} label="Модель" />
    <ActionMenu
      items={[
        { label: 'Открыть в проводнике', onselect: () => undefined },
        { label: 'Открыть в терминале', onselect: () => undefined },
        'separator',
        { label: 'Удалить…', danger: true, onselect: () => onconfirm() },
      ]}
    />
  </div>
</InventorySection>
