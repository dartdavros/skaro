<script lang="ts">
  import {
    ActionMenu,
    AgentLogo,
    Banner,
    Button,
    Checkbox,
    ConfirmDialog,
    EffortSlider,
    FilterMenu,
    Icon,
    IconButton,
    Modal,
    NavPanel,
    Progress,
    ProjectTabs,
    RadioCards,
    Segmented,
    Select,
    StatusDot,
    t,
    TaskCard,
    TextField,
    Toggle,
    type DotState,
    type NavItem,
    type ProjectTab,
  } from '@skaro/ui';

  /** The UI inventory rebuilt from Svelte components, to check against docs/mockups/UI Inventory. */

  const swatches = [
    ['Топбар / панель', '#0f0f0f'],
    ['Основной фон', '#121212'],
    ['Поверхность', '#1a1a1a'],
    ['Поверхность +', '#242424'],
    ['Поле ввода', '#2b2b2b'],
    ['Подложка переключателя', '#060606'],
    ['Акцент', '#2a52be'],
    ['Сообщение пользователя', '#1c2a4d'],
    ['Ссылка', '#7d9ce8'],
    ['Коралл · код', '#e8875b'],
    ['Ошибка', '#ef6a63'],
    ['Предупреждение', '#e0a33c'],
    ['Текст яркий', '#ededed'],
    ['Текст', '#d5d5d5'],
    ['Текст вторичный', '#a6a6a6'],
    ['Текст приглушённый', '#7d7d7d'],
  ] as const;

  let bumps = $state(0);
  let view = $state<'board' | 'list'>('board');
  let effort = $state<'low' | 'medium' | 'high'>('medium');
  let layout = $state<'grid' | 'list'>('grid');
  let sliderValue = $state('xhigh');
  let planFirst = $state(false);

  let statusFilter = $state<string[]>(['need']);
  let agentFilter = $state<string[]>([]);
  const statuses: { value: string; label: string; dot: DotState }[] = [
    { value: 'todo', label: 'Не начата', dot: 'idle' },
    { value: 'working', label: 'В работе', dot: 'working' },
    { value: 'need', label: 'Нужен ответ', dot: 'attention' },
    { value: 'review', label: 'На ревью', dot: 'attention' },
    { value: 'error', label: 'Ошибка', dot: 'error' },
    { value: 'done', label: 'Готово', dot: 'done' },
  ];
  let model = $state('opus');
  const models = [
    {
      value: 'fable',
      label: 'Fable 5.1',
      description: 'Максимальная глубина — медленнее и дороже',
    },
    { value: 'opus', label: 'Opus 5', description: 'По умолчанию для агентной разработки' },
    { value: 'sonnet', label: 'Sonnet 5', description: 'Баланс скорости и качества' },
    { value: 'haiku', label: 'Haiku 4.5', description: 'Быстрая и дешёвая, для простых правок' },
  ];

  let search = $state('');
  let projectName = $state('');
  let checks = $state({ a: true, b: false, c: false });
  let mode = $state<'ask' | 'auto' | 'full'>('auto');

  let tabs = $state<ProjectTab[]>([
    { id: 'shop', label: 'Shop API', state: 'working' },
    { id: 'blog', label: 'Blog Engine', state: 'attention' },
    { id: 'landing', label: 'Skaro Landing' },
  ]);
  let activeTab = $state('shop');
  let nav = $state('tasks');
  let navCollapsed = $state(false);
  const navItems: NavItem[] = [
    { id: 'overview', label: 'Обзор', tip: 'Состояние проекта', icon: 'overview' },
    { id: 'docs', label: 'Документы', tip: 'Бриф, архитектура, решения', icon: 'docs' },
    { id: 'plan', label: 'План', tip: 'Этапы', icon: 'plan' },
    {
      id: 'tasks',
      label: 'Задачи',
      tip: 'Доска и список',
      icon: 'tasks',
      count: 2,
      countTip: '2 требуют внимания',
    },
    { id: 'chat', label: 'Чат', tip: 'Работа с агентом', icon: 'chat', separated: true },
    { id: 'params', label: 'Параметры', tip: 'Параметры проекта', icon: 'params' },
  ];

  let cardsLog = $state('Клик по карточке — открыть · чекбокс — выделить');
  let cards = $state([
    {
      title: 'Роли и доступы админки',
      stage: 'M03 · Админка',
      time: '—',
      agent: 'claude-code' as const,
      state: 'blocked' as DotState,
      tip: 'Заблокирована: ждёт T-004',
      selected: false,
    },
    {
      title: 'Вебхуки Stripe',
      stage: 'M02 · Платежи',
      time: '12 мин',
      agent: 'codex' as const,
      state: 'working' as DotState,
      tip: 'Агент работает',
      selected: false,
    },
    {
      title: 'Идемпотентность платежей',
      stage: 'M02 · Платежи',
      time: '1 ч',
      agent: 'claude-code' as const,
      state: 'attention' as DotState,
      tip: 'Нужен ответ',
      selected: false,
    },
    {
      title: 'Миграции заказов',
      stage: 'M01 · Каталог',
      time: '3 ч',
      agent: 'claude-code' as const,
      state: 'error' as DotState,
      tip: 'Ошибка запуска',
      selected: false,
    },
  ]);
  const selectedCount = $derived(cards.filter((c) => c.selected).length);

  let modal = $state(false);
  let confirm = $state(false);
  let agent = $state<'claude-code' | 'codex'>('claude-code');
  let modalEffort = $state<'low' | 'medium' | 'high'>('medium');
  let banners = $state({ warn: true, err: true });
  let progress = $state(3);
</script>

<div class="inventory">
  <div class="intro">
    <h1 class="sk-title">{t('inventory.title')}</h1>
    <p class="lead">{t('inventory.subtitle')}</p>
  </div>

  <section>
    <div class="head">
      <h2>01 · Цвета</h2>
      <p>
        Акцент — синий, только для кликабельного и «требует внимания». Коралл — некликабельные
        выделения (код, команды). Зелёный — только «+» в диффе.
      </p>
    </div>
    <div class="swatches">
      {#each swatches as [name, hex] (hex)}
        <button
          type="button"
          class="swatch"
          data-tip={`Скопировать ${hex}`}
          onclick={() => navigator.clipboard?.writeText(hex)}
        >
          <span class="chip" style="background: {hex}"></span>
          <span class="swatch-name">{name}</span>
          <span class="swatch-hex">{hex}</span>
        </button>
      {/each}
    </div>
  </section>

  <section>
    <div class="head">
      <h2>02 · Типографика</h2>
      <p>
        Nunito Sans — интерфейс, JetBrains Mono — ID, пути, ветки, числа. Чистый белый не
        используется: максимум #ededed.
      </p>
    </div>
    <div class="type">
      <div class="type-row">
        <span class="spec">Заголовок · 23/700</span><span class="sk-title">Проекты</span>
      </div>
      <div class="type-row">
        <span class="spec">Название · 14.5/600</span><span class="sk-name"
          >Роли и доступы админки</span
        >
      </div>
      <div class="type-row">
        <span class="spec">Текст · 13/400</span><span class="sk-text"
          >Проверка прав в сервисном слое, а не только в UI.</span
        >
      </div>
      <div class="type-row">
        <span class="spec">Вторичный · 12/400</span><span class="sk-secondary">3 часа назад</span>
      </div>
      <div class="type-row">
        <span class="spec">Метка раздела · 11/600</span><span class="sk-label"
          >Критерии приёмки</span
        >
      </div>
      <div class="type-row last">
        <span class="spec">Моно · 12/400</span>
        <span class="mono-row sk-mono">
          <span style="color: var(--sk-text-secondary)">T-020</span>
          <code data-tip="Некликабельный фрагмент кода — коралл">npm run test</code>
          <a href="#top" data-tip="Ссылка на файл — светлый синий">src/auth/policy.ts</a>
        </span>
      </div>
    </div>
  </section>

  <section>
    <div class="head">
      <h2>03 · Индикаторы состояния</h2>
      <p>
        Точка без текста, смысл — в подсказке. Работает — серая мигающая. Требует внимания (ответ,
        ревью, завершено) — синяя статичная. Ошибка — красная. Заблокировано — замок. Во вкладках —
        никаких чисел.
      </p>
    </div>
    <div class="row wrap">
      <div class="chip-card" data-tip="Агент работает">
        <StatusDot state="working" tip="" /><span>В работе</span>
      </div>
      <div class="chip-card" data-tip="Нужен ответ / на ревью / завершено">
        <StatusDot state="attention" tip="" /><span>Требует внимания</span>
      </div>
      <div class="chip-card" data-tip="Запуск упал">
        <StatusDot state="error" tip="" /><span>Ошибка</span>
      </div>
      <div class="chip-card" data-tip="Ждёт завершения зависимостей">
        <StatusDot state="blocked" tip="" /><span>Заблокирована</span>
      </div>
      <div class="chip-card counts" data-tip="На карточке проекта: точка + число">
        <span class="count" data-tip="В работе: 2"><StatusDot state="working" tip="" />2</span>
        <span class="count" data-tip="Нужен ответ: 1"><StatusDot state="attention" tip="" />1</span>
        <span class="count" data-tip="Ошибка: 1"><StatusDot state="error" tip="" />1</span>
      </div>
    </div>
  </section>

  <section>
    <div class="head">
      <h2>04 · Кнопки</h2>
      <p>
        Главная — одна на экран, синяя с белым текстом. Вторичная — серая поверхность. Иконки-кнопки
        — фон только при наведении. Круглые — только в поле ввода.
      </p>
    </div>
    <div class="panel row wrap">
      <Button variant="primary" data-tip="Главное действие экрана" onclick={() => bumps++}
        ><Icon name="plus" size={15} stroke={2.6} />Новая задача</Button
      >
      <Button data-tip="Вторичное действие" onclick={() => bumps++}>Бриф</Button>
      <Button variant="danger" data-tip="Разрушительное действие — только в модалке">Удалить</Button
      >
      <span class="vsep"></span>
      <IconButton tip="Иконка-кнопка"><Icon name="filters" size={16} /></IconButton>
      <IconButton tip="Скопировать" tone="muted"
        ><Icon name="copy" size={14} stroke={1.9} /></IconButton
      >
      <span class="vsep"></span>
      <IconButton variant="round" tip="Прикрепить — круглый фон при наведении"
        ><Icon name="plus" size={15} stroke={2.6} /></IconButton
      >
      <IconButton variant="send" tip="Отправить"
        ><Icon name="send" size={14} stroke={2.3} /></IconButton
      >
      <IconButton variant="round" tone="bright" tip="Остановить агента">
        <svg width="16" height="16" viewBox="0 0 16 16"
          ><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" /><rect
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
      <span class="log">{bumps ? `нажато: ${bumps}` : ''}</span>
    </div>
  </section>

  <section>
    <div class="head">
      <h2>05 · Переключатель</h2>
      <p>
        Один вид для всех взаимоисключающих выборов: вид, сортировка, архив, усилие, изоляция.
        Подложка почти чёрная, активный пункт — цвета основного фона.
      </p>
    </div>
    <div class="panel row wrap">
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
    <div class="panel column narrow">
      <span class="sk-label">Ползунок усилия</span>
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
      <span class="note"
        >Число шагов зависит от модели (2–5). Тянуть, кликать по дорожке или стрелками с клавиатуры;
        справа — «Вернуть по умолчанию».</span
      >
    </div>
    <div class="panel column narrow">
      <span class="sk-label">Тумблер вкл/выкл</span>
      <Toggle bind:checked={planFirst} label="Сначала план" />
      <span class="note">Одиночная настройка «включено / выключено»: 32×18, включено — синий.</span>
    </div>
  </section>

  <section>
    <div class="head">
      <h2>06 · Выпадающие списки</h2>
      <p>
        Только кастомные, не системные селекты. Фильтр — множественный выбор с цветным маркером
        статуса или логотипом агента. Селект модели — одиночный, сверху самые сильные, с пояснением.
        Меню действий — список с разделителем перед опасным пунктом. Закрываются кликом снаружи.
      </p>
    </div>
    <div class="panel row menus">
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
          { label: 'Удалить…', danger: true, onselect: () => (confirm = true) },
        ]}
      />
    </div>
  </section>

  <section>
    <div class="head">
      <h2>07 · Поля, чекбоксы, радио</h2>
      <p>
        Поле и селект выглядят одинаково на любом фоне и ставятся только в карточку или модалку.
        Открытый список всегда светлее поверхности и с тенью. Чекбоксы тёмные, без акцента.
        Радио-карточка — для выбора с пояснением; рискованный вариант подсвечен жёлтым.
      </p>
    </div>
    <div class="grid2">
      <div class="panel column">
        <TextField search placeholder="Поиск по названию или пути" bind:value={search} />
        <TextField label="Название проекта" placeholder="shop-api" bind:value={projectName} />
        <div class="checks">
          <Checkbox bind:checked={checks.a} label="Юнит-тесты на матрицу прав" />
          <Checkbox bind:checked={checks.b} label="Попытка без прав — 403 и запись в журнал" />
          <Checkbox bind:checked={checks.c} label="Проверка в сервисном слое" />
        </div>
      </div>
      <div class="panel tight">
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
  </section>

  <section>
    <div class="head">
      <h2>08 · Навигация</h2>
      <p>
        Вкладки проектов в топбаре: активная — цвета основного фона, рамка слева-сверху-справа,
        скруглённые нижние «ушки»; неактивные подсвечиваются при наведении, крестик — со своим
        ховером. Правая панель — разделы проекта, сворачивается в рельс; «Чат» отделён линией.
      </p>
    </div>
    <div class="nav-demo">
      <div class="nav-bar">
        <ProjectTabs
          {tabs}
          active={activeTab}
          onselect={(id) => (activeTab = id)}
          onclose={(id) => (tabs = tabs.filter((tab) => tab.id !== id))}
          onadd={() => {
            tabs = [
              { id: 'shop', label: 'Shop API', state: 'working' },
              { id: 'blog', label: 'Blog Engine', state: 'attention' },
              { id: 'landing', label: 'Skaro Landing' },
            ];
            activeTab = 'shop';
          }}
        />
      </div>
      <div class="nav-body">
        <div class="nav-content">Контент экрана</div>
        <NavPanel
          title="Shop API"
          items={navItems}
          active={nav}
          bind:collapsed={navCollapsed}
          onselect={(id) => (nav = id)}
        />
      </div>
    </div>
  </section>

  <section>
    <div class="head">
      <h2>09 · Карточки задач</h2>
      <p>
        Все карточки одинаковые, отличается только индикатор справа сверху. Сверху название, ниже
        этап, внизу время слева и лого агента справа. Клик открывает задачу, выделение — только
        чекбоксом (появляется при наведении или выборе). Статус колонки на карточке не дублируется.
      </p>
    </div>
    <div class="cards">
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
    <span class="log">{selectedCount ? `Выделено: ${selectedCount}` : cardsLog}</span>
  </section>

  <section>
    <div class="head">
      <h2>11 · Обратная связь</h2>
      <p>
        Тултип — чёрный, без обводки, ширина по содержимому, не выходит за окно. Баннер — текст
        одного цвета, соответствующего типу. Прогресс — только оттенки серого. Модалка — для любых
        действий с задачами (удаление, перенос, архив).
      </p>
    </div>
    <div class="panel column">
      <div class="row wrap">
        <span class="pill" data-tip="Короткая подсказка">Наведи — короткий тултип</span>
        <span
          class="pill"
          data-tip="Длинная подсказка переносится на несколько строк, но не шире 260 пикселей и никогда не выходит за край окна"
          >Наведи — длинный тултип</span
        >
        <Button size="sm" onclick={() => (modal = true)}>Модалка выбора агента</Button>
        <Button size="sm" onclick={() => (confirm = true)}>Модалка подтверждения</Button>
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
  </section>
</div>

<Modal bind:open={modal} title="Агент задачи">
  <div class="agents">
    {#each [{ id: 'claude-code', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }] as const as option (option.id)}
      <button
        type="button"
        class="agent"
        class:on={agent === option.id}
        onclick={() => (agent = option.id)}
      >
        <AgentLogo agent={option.id} size={21} />
        <span>{option.name}</span>
      </button>
    {/each}
  </div>
  <div class="column-sm">
    <span class="sk-label">Усилие</span>
    <div>
      <Segmented
        bind:value={modalEffort}
        options={[
          { value: 'low', label: 'Низкое' },
          { value: 'medium', label: 'Среднее' },
          { value: 'high', label: 'Высокое' },
        ]}
      />
    </div>
  </div>
  {#snippet footer()}
    <Button onclick={() => (modal = false)}>Отмена</Button>
    <Button variant="primary" onclick={() => (modal = false)}>Сохранить</Button>
  {/snippet}
</Modal>

<ConfirmDialog
  bind:open={confirm}
  title="Удалить 2 задачи?"
  text="Задачи и их ветки будут удалены. Это действие нельзя отменить."
  action="Удалить"
  onconfirm={() => undefined}
/>

<style>
  .inventory {
    max-width: 1120px;
    margin: 0 auto;
    padding: 14px 6px 80px;
    display: flex;
    flex-direction: column;
    gap: 44px;
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .lead {
    margin: 0;
    max-width: 640px;
    font-size: 13.5px;
    line-height: 1.6;
    color: #8a8a8a;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--sk-text);
  }

  .head p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--sk-text-muted);
    text-wrap: pretty;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .swatch {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: none;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
    text-align: left;
    cursor: pointer;
  }

  .swatch:hover {
    background: var(--sk-surface-hover);
  }

  .chip {
    height: 44px;
    border-radius: 7px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }

  .swatch-name {
    padding: 0 2px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--sk-text);
  }

  .swatch-hex {
    margin-top: -7px;
    padding: 0 2px;
    font-family: var(--sk-mono);
    font-size: 11px;
    color: var(--sk-text-muted);
  }

  .type {
    display: flex;
    flex-direction: column;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
    overflow: hidden;
  }

  .type-row {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 16px;
    align-items: baseline;
    padding: 12px 16px;
    border-bottom: 1px solid #141414;
  }

  .type-row.last {
    border-bottom: none;
  }

  .spec {
    font-family: var(--sk-mono);
    font-size: 11px;
    color: var(--sk-text-label);
  }

  .mono-row {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .wrap {
    flex-wrap: wrap;
  }

  .chip-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
    font-size: 12.5px;
    color: var(--sk-text-secondary);
  }

  .counts {
    gap: 14px;
  }

  .count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--sk-mono);
    font-size: 12px;
  }

  .panel {
    padding: 18px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
  }

  .panel.tight {
    padding: 12px;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .column-sm {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .narrow {
    max-width: 460px;
    gap: 10px;
  }

  .note {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--sk-text-muted);
  }

  .vsep {
    width: 1px;
    height: 22px;
    background: var(--sk-line-strong);
  }

  .log {
    font-family: var(--sk-mono);
    font-size: 11px;
    color: var(--sk-text-label);
  }

  .menus {
    align-items: flex-start;
    min-height: 330px;
  }

  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 12px;
  }

  .checks {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding-top: 4px;
  }

  .nav-demo {
    display: flex;
    flex-direction: column;
    border-radius: var(--sk-radius-card);
    overflow: hidden;
    box-shadow: inset 0 0 0 1px var(--sk-line);
  }

  .nav-bar {
    height: 42px;
    display: flex;
    padding: 0 10px 0 14px;
    background: var(--sk-topbar);
    border-bottom: 1px solid var(--sk-surface-2);
  }

  .nav-body {
    height: 300px;
    display: flex;
    background: var(--sk-bg);
  }

  .nav-content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12.5px;
    color: #5f5f5f;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 11px;
    border-radius: 7px;
    background: var(--sk-surface-2);
    font-size: 12.5px;
    color: #c8c8c8;
    cursor: default;
  }

  .progress {
    max-width: 360px;
    cursor: pointer;
  }

  .agents {
    display: flex;
    gap: 9px;
  }

  .agent {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 13px;
    border: none;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface-2);
    color: var(--sk-text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .agent:hover,
  .agent.on {
    background: #0d0d0d;
  }

  .agent.on {
    color: var(--sk-text);
  }
</style>
