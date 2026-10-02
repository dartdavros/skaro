<script lang="ts">
  import { NavPanel, ProjectTabs } from '@skaro/ui';
  import InventorySection from './InventorySection.svelte';
  import { navItems, projectTabs } from './data';

  let tabs = $state(projectTabs());
  let activeTab = $state('shop');
  let nav = $state('tasks');
  let navCollapsed = $state(false);
</script>

<InventorySection
  title="08 · Навигация"
  note="Вкладки проектов в топбаре: активная — цвета основного фона, рамка слева-сверху-справа, скруглённые нижние «ушки»; неактивные подсвечиваются при наведении, крестик — со своим ховером. Правая панель — разделы проекта, сворачивается в рельс; «Чат» отделён линией."
>
  <div data-inventory class="nav-demo">
    <div data-inventory class="nav-bar">
      <ProjectTabs
        {tabs}
        active={activeTab}
        onselect={(id) => (activeTab = id)}
        onclose={(id) => (tabs = tabs.filter((tab) => tab.id !== id))}
        onadd={() => {
          tabs = projectTabs();
          activeTab = 'shop';
        }}
      />
    </div>
    <div data-inventory class="nav-body">
      <div data-inventory class="nav-content">Контент экрана</div>
      <NavPanel
        title="Shop API"
        items={navItems}
        active={nav}
        bind:collapsed={navCollapsed}
        onselect={(id) => (nav = id)}
      />
    </div>
  </div>
</InventorySection>
