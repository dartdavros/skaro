# Вывод агентов: реальность, модель, отображение

Что на самом деле отдают Claude Code и Codex, как Skaro приводит это к своей модели и какими из-за этого должны стать агентские блоки макетов: лента задачи, чат, модалка агента. Отдельная цель — чтобы изменения форматов у агентов не заставляли переписывать интерфейс.

Факты собраны 23.09.2026: Claude Code 2.1.280 / Agent SDK 0.3.280, Codex 0.156.1 (app-server protocol v2 из `main`). Источники — типы пакетов и JSON-схемы протоколов.

---

## 0. Коротко

1. **Агент отдаёт не текст, а поток структурированных событий.** Это сообщения, размышления, вызовы инструментов с результатами, план, запросы разрешений, вопросы, фоновые задачи, субагенты, повторы, ошибки и расход. У Claude Code — 39 типов сообщений и 43 встроенных инструмента (в версии 2.1.138 четыре месяца назад было 20). У Codex — 20 типов элементов, 83 уведомления и 10 серверных запросов.
2. **Форматы меняются очень часто** (замер — раздел 8): за 90 дней 77 версий Agent SDK (80 добавлений, 20 изменений поведения, 2 удаления) и 250 коммитов в схему протокола Codex. Поэтому версии агентов закреплены релизом Skaro, а обновление идёт через контрактные тесты.
3. **Архитектура — три слоя:** транспорт → адаптер агента → каноническая модель Skaro → интерфейс. Интерфейс не знает нативных форматов. Сырой поток хранится всегда, ленту можно пересобрать. Что Skaro может проверить сам (diff, проверки, время), он считает сам.
4. **Агентские макеты нужно привести к реальности** (раздел 5). Основное:
   - нет карточки **запроса разрешения**, хотя она нужна почти в каждом запуске;
   - карточка вопроса проще реальной: нет нескольких вопросов, множественного выбора и своего ответа на каждый вопрос;
   - план агента должен быть одной обновляемой закреплённой карточкой;
   - у команд Claude нет кода выхода и длительности;
   - правки файлов приходят по одной, их нужно схлопывать;
   - нет вида для размышлений, субагентов, повторов, лимитов, остановки и сжатия контекста;
   - модели и уровни усилия берутся у агента и зависят от модели;
   - переключение агента внутри чата невозможно без потери памяти.
5. **Транспорт:** Claude Code — через Agent SDK с его собственным закреплённым бинарником (принято). Codex — через `codex app-server`.

---

## 1. Что реально отдают агенты

### 1.1 Claude Code

**Транспорт.** Agent SDK запускает бинарник Claude Code и общается с ним по stdio: JSON-строки плюс управляющий протокол `control_request` / `control_response` для разрешений, вопросов и прерывания. Управляющий протокол не документирован, стабилен он только через SDK. SDK 0.3.x приносит собственный бинарник (`@anthropic-ai/claude-agent-sdk-<platform>`, около 230 МБ, версия CLI 2.1.<версия SDK>). Настройки и авторизацию бинарник берёт из общего `~/.claude`.

**Сообщения потока (`SDKMessage`, 39 вариантов).** Главные:

| Тип | Что несёт |
|---|---|
| `system/init` | модель, инструменты, MCP-серверы, режим прав, `effort`, **`capabilities`** (флаги протокола для feature detection), версия CLI |
| `assistant` | `message.content[]`: `text`, `thinking` / `redacted_thinking`, `tool_use` (id, name, input). `error` — категория ошибки. `parent_tool_use_id` — субагент |
| `user` | блок `tool_result` (для модели) + **`tool_use_result`** (структурированный результат для UI) |
| `stream_event` | частичные события (`text_delta`, `thinking_delta`, `input_json_delta`), при `includePartialMessages` |
| `result` | итог хода: `subtype`, **`is_error`**, `result`, `usage`, `permission_denials`, `terminal_reason` |
| `system/task_started` · `task_progress` · `task_updated` · `task_notification` · `background_tasks_changed` | фоновые команды и субагенты |
| `tool_progress` | «инструмент работает N с» |
| `tool_use_summary` | сводка агента по группе вызовов |
| `system/api_retry` | повтор запроса: попытка, задержка, категория |
| `system/status` · `compact_boundary` | сжатие контекста |
| `system/session_state_changed` | `idle` / `running` / `requires_action` |
| `system/permission_denied` | отказ правилом или режимом |
| `rate_limit_event` | лимиты |
| `system/model_refusal_*`, `informational`, `notification` | отказ модели, информационные сообщения |
| остальные ~15 | хуки, плагины, память, команды, файлы — служебные |

**Встроенные инструменты** (`sdk-tools.d.ts` из SDK 0.3.280, схемы входа и выхода, 43 штуки). Для ленты важны: `Read`, `Write`, `Edit`, `NotebookEdit`, `Glob`, `Grep`, `Bash` / `PowerShell`, `Monitor`, `TaskStop`, `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList`, `TodoWrite` (устарел), `Agent`, `Workflow`, `WebFetch`, `WebSearch`, `AskUserQuestion`, `EnterPlanMode` / `ExitPlanMode`, `EnterWorktree` / `ExitWorktree`, MCP-ресурсы. Остальные (расписания, уведомления, артефакты, навыки и т.п.) Skaro показывает как `tool` или отключает. MCP-инструменты называются `mcp__<server>__<tool>`. Что важно для UI:
- `Edit` → `structuredPatch[]`, `gitDiff{additions, deletions, patch}` (не всегда). Одна правка = один вызов.
- `Write` → `type: create|update`.
- `Bash` → вход `command`, `description`, `run_in_background`. Выход `stdout`, `stderr`, `interrupted`, `backgroundTaskId`. **Кода выхода и длительности в структуре нет:** есть только `is_error` и текст «Exit code N» внутри вывода. Вывод приходит целиком по завершении.
- **План агента** — Task-инструменты: `TaskCreate{subject, description, activeForm}` → `task.id`, `TaskUpdate{taskId, status: pending|in_progress|completed|deleted, subject, activeForm, addBlockedBy}`. План собирается накоплением по `taskId`, а не заменой списка целиком. Старый `TodoWrite` (снимок списка целиком) встречается на старых моделях. **На новых моделях (Opus 4.8, Sonnet 5, Fable 5, Mythos 5 и новее) Task-инструментов по умолчанию нет** — Skaro включает их явно через `tools` / `allowedTools`, иначе плана не будет.
- `Bash` дополнительно отдаёт `gitOperation` (агент сделал коммит), `timedOutAfterMs`, `persistedOutputPath` (длинный вывод сохранён в файл).
- `AskUserQuestion` → 1–4 вопроса: `header` (до 12 символов), `question`, 2–4 `options{label, description, preview?}`, `multiSelect`.
- **Изображения:**
  - `Read` картинки → `type: "image"`, `file{base64, type: png|jpeg|gif|webp, dimensions}`; путь — во входе вызова.
  - `Read` PDF → `pdf` / `parts`: картинки страниц в результат не сохраняются, остаются только путь и число страниц.
  - Результат MCP-инструмента — массив блоков, среди них `{type: "image", data, mimeType}`: скриншоты браузерных MCP, диаграммы и т.п.
  - `Bash` → флаг `isImage`, если stdout — картинка.
  - Сам Claude Code картинок не генерирует.

**Ввод пользователя.**
- Разрешения и вопросы приходят в `canUseTool(toolName, input, {suggestions, toolUseID, decisionReason, title, …})`. Ответ на вопрос возвращается через `allow` + `updatedInput{questions, answers}`, где ключ — текст вопроса. Свой ответ идёт туда же, общий ответ — в `response`.
- «Разрешить всегда» — эхо `suggestions` в `updatedPermissions`.
- Управление сессией: `interrupt()`, `streamInput()` (дописать по ходу работы), `setModel()`, `setPermissionMode()`, `resume` / `forkSession`, `stopTask(taskId)`.
- `supportedModels()` → `ModelInfo{value, displayName, description, supportedEffortLevels}`. Уровни усилия: `low | medium | high | xhigh | max`, набор зависит от модели.
- Долгое ожидание ответа можно отложить через хук `PreToolUse` → `defer`: процесс завершается, сессия продолжается позже.

### 1.2 Codex

**Транспорт.** `codex app-server` — JSON-RPC 2.0 по stdio (JSONL). Рукопожатие: `initialize{clientInfo, capabilities{experimentalApi, optOutNotificationMethods}}` → `initialized`. Codex SDK (TS) работает поверх `codex exec --experimental-json`: другой, урезанный формат, без подтверждений, вопросов и `steer`. Для Skaro он не подходит.

**Примитивы.** Thread → Turn → Item. Жизненный цикл элемента: `item/started` → дельты → `item/completed`. Итог хода — `turn/completed{status: completed|interrupted|failed, error}`.

**Элементы (`ThreadItem`, 20):** `userMessage`, `agentMessage` (`phase: commentary|final_answer`), `reasoning` (`summary[]`, `content[]`), `commandExecution` (`command`, `commandActions[]`, `aggregatedOutput`, `exitCode`, `durationMs`, `status: inProgress|completed|failed|declined`), `fileChange` (`changes[{path, kind: add|delete|update(move_path), diff}]`, тот же `status`), `mcpToolCall`, `dynamicToolCall`, `webSearch`, `plan`, `collabAgentToolCall`, `subAgentActivity`, `imageView`, `imageGeneration`, `contextCompaction`, `enteredReviewMode` / `exitedReviewMode`, `hookPrompt`, `functionCallOutput`, `sleep`.

**`commandActions`** — Codex сам классифицирует shell-команды: `read{path}`, `search{query, path}`, `listFiles{path}`, `unknown`. Codex читает файлы через shell, поэтому только так можно показать «Прочитал 6 файлов».

**Уведомления (83).** Ключевые: `item/agentMessage/delta`, `item/reasoning/summaryTextDelta` / `textDelta`, `item/commandExecution/outputDelta` (живой вывод), `item/fileChange/patchUpdated`, `turn/plan/updated` (`plan[{step, status: pending|inProgress|completed}]`), `turn/diff/updated`, `thread/tokenUsage/updated`, `account/rateLimits/updated`, `thread/status/changed` (`waitingOnApproval|waitingOnUserInput`), `thread/name/updated`, `error{willRetry}`, `warning`, `deprecationNotice`, `thread/compacted`, `serverRequest/resolved`. Остальное (realtime, файловый поиск, плагины, аккаунт, Windows) отключается через `optOutNotificationMethods`.

**Серверные запросы:**
- `item/commandExecution/requestApproval` — `command`, `commandActions`, `cwd`, `reason`, сетевой контекст. Решения: `accept` / `acceptForSession` / `acceptWithExecpolicyAmendment` / `applyNetworkPolicyAmendment` / `decline` / `cancel`.
- `item/fileChange/requestApproval` — `reason`, `grantRoot`. Решения: `accept` / `acceptForSession` / `decline` / `cancel`.
- `item/permissions/requestApproval` — расширение прав.
- `item/tool/requestUserInput` — `questions[{id, header, question, options[{label, description}], isOther, isSecret}]`. Ответ: `answers{[id]: {answers: string[]}}`.
- `mcpServer/elicitation/request` — форма от MCP-сервера.

**Управление:** `turn/start` (модель и `reasoningEffort` — на ход), `turn/steer` (дописать в текущий ход; падает, если хода нет), `turn/interrupt`, `thread/resume`, `thread/fork`, `model/list` → `Model{displayName, description, isDefault, hidden, supportedReasoningEfforts[{reasoningEffort, description}], defaultReasoningEffort, inputModalities}`.

**Ввод:** `text`, `image` / `localImage`, `mention{name, path}` (ссылка на файл или папку), `skill`. Принимает ли модель картинки — `Model.inputModalities`.

**Изображения на выходе:**
- `imageView{path}` — агент посмотрел картинку;
- `imageGeneration{result, savedPath, revisedPrompt, status, failure}` — Codex сгенерировал картинку и сохранил её на диск (`failure` — например, лимит);
- `mcpToolCall.result.content[]` — MCP-блоки, в том числе `image`;
- `dynamicToolCall.contentItems[]` — `inputImage{imageUrl}`.

**Схемы:** `codex app-server generate-json-schema --out DIR` / `generate-ts --out DIR` — ровно для установленной версии. Экспериментальная часть закрыта флагом `experimentalApi`.

### 1.3 Общее и различия

По смыслу агенты сходятся: сообщение, размышление, чтение и поиск, правка, команда, план, вопрос с вариантами, разрешение, субагент, фоновая задача, итог хода. Различаются упаковка и полнота данных:

| Данные | Claude Code | Codex |
|---|---|---|
| Живой вывод команды | нет, вывод целиком в конце | да (`outputDelta`) |
| Код выхода команды | нет в структуре (`is_error` + текст) | `exitCode` |
| Длительность команды | нет, мерит Skaro | `durationMs` |
| Описание команды человеческим языком | `description` | нет |
| Правки файлов | один вызов = одна правка одного файла | один элемент = несколько файлов с diff |
| Чтение файлов | отдельные инструменты | shell + `commandActions` |
| План | Task-инструменты, накопление по id, `activeForm` | `turn/plan/updated`, снимок целиком |
| Вопросы | 1–4 вопроса, `multiSelect`, `preview` | вопросы с `isOther`, `isSecret` |
| Дописать по ходу | `streamInput`, подхватывается между шагами | `turn/steer` |
| Название чата | нет | `thread/name/updated` |

Примеры изменчивости, которые должна пережить архитектура:
- до Claude Code 2.1.207 `allow` без `updatedInput` отклонялся;
- до 2.1.219 вложенные субагенты не попадали в поток;
- в Codex удалён `thread/rollback`, а у `exec --json` и app-server разные имена одних и тех же полей;
- **проверено локально:** ошибка авторизации Claude Code приходит синтетическим `assistant`-сообщением «Not logged in» и `result` с `subtype: "success"`, но `is_error: true`.

---

## 2. Принципы устойчивости

**П1. Три слоя.** `Транспорт` (процесс, протокол, ответы на запросы) → `Адаптер` (нативное → каноническое) → `Лента` (состояние, группировка, рендер). Компоненты Svelte не импортируют нативных типов.

**П2. Сырой поток — источник истины, лента — проекция.** Каждая нативная строка пишется в `runs/…/<run>.jsonl` / `chats/…/<chat>.jsonl` до разбора, с версией агента и адаптера. Лента — кеш с `adapter_version`. Исправили адаптер — история пересобирается.

**П3. Толерантное чтение.** Каждое событие разбирается в своём `try/catch`. Схемы проверяют только используемые поля, неизвестные пропускаются. Неизвестный тип становится `unknown` (виден в режиме отладки), неизвестный инструмент — `tool`. Нет необязательного поля — отображение деградирует, ошибки нет. Счётчик необработанных типов — в отладочной панели.

**П4. Классификация по таблицам.** «Нативный инструмент или элемент → канонический вид» — декларативный реестр. Новый инструмент — одна строка в реестре, а до этого он показывается как `tool`.

**П5. Что можно проверить самому — считаем сами.** Изменённые файлы и diff для слияния — из git worktree. Проверки — `CheckRunner`. Длительности — часы Skaro. Поток агента — только повествование.

**П6. Предложения Skaro — через наш MCP-сервер.** Карточки документов, ADR, этапов и задач рождаются из вызовов инструментов нашего MCP-сервера с типизированными данными. Вывод агента ради них не разбирается.

**П7. Проверка возможностей вместо версий.** Claude: `system/init.capabilities`, `tools`, `supportedModels()`. Codex: при обнаружении генерируем схему установленной версии и сравниваем со снимком адаптера. Возможности попадают в `session.capabilities`, интерфейс под них подстраивается.

**П8. Закреплённые версии и контрактные тесты.** Golden-записи реальных сессий по сценариям (чтение, правка, падающая команда, фоновая команда, вопрос, разрешение, субагент, прерывание, ошибка авторизации, сжатие) прогоняются через адаптер в CI. Ночная канарейка гоняет те же сценарии на свежих версиях агентов.

---

## 3. Каноническая модель

Эскиз типов: названия не окончательные, смысл — да.

```ts
type TimelineEvent =
  | { t: 'session.started'; nativeSessionId: string; model: string; capabilities: AgentCapabilities }
  | { t: 'turn.started'; turnId: string }
  | { t: 'item.upsert'; item: Item }
  | { t: 'item.append'; itemId: string; field: 'text' | 'output'; chunk: string }
  | { t: 'plan.updated'; steps: PlanStep[] }
  | { t: 'interaction.opened'; interaction: Interaction }
  | { t: 'interaction.closed'; id: string; resolution: 'answered' | 'cancelled' | 'expired' }
  | { t: 'usage'; inputTokens: number; outputTokens: number; contextWindow?: number; contextUsedPct?: number }
  | { t: 'activity'; state: 'thinking' | 'writing' | 'preparing_edit' | 'waiting_model'; target?: string } // живая строка
  | { t: 'rewound'; toItemId: string }                            // откат к сообщению
  | { t: 'limits'; state: 'ok' | 'warning' | 'exhausted'; resetsAt?: string }
  | { t: 'status'; state: 'working' | 'waiting' | 'idle' }
  | { t: 'turn.completed'; turnId: string; outcome: 'done' | 'interrupted' | 'failed'; error?: AgentError };

interface ItemBase {
  id: string; turnId: string;
  parentId?: string;                     // элементы субагента
  status: 'queued' | 'running' | 'done' | 'failed' | 'declined' | 'interrupted';
  startedAt: number; endedAt?: number;   // время ставит Skaro
  native: { agent: string; type: string; ref: string };
}

type Item = ItemBase & (
  | { kind: 'message'; role: 'user' | 'agent'; text: string; phase?: 'commentary' | 'final' | 'plan' }
  | { kind: 'reasoning'; text?: string; redacted?: boolean }
  | { kind: 'explore'; op: 'read' | 'search' | 'list' | 'fetch' | 'web'; target: string; detail?: string }
  | { kind: 'file_change'; files: { path: string; change: 'add' | 'update' | 'delete' | 'move';
        movePath?: string; diff?: string; added?: number; removed?: number }[] }
  | { kind: 'command'; command: string; description?: string; output: string; outputLive: boolean;
        exitCode?: number; awaitingInput?: boolean; background?: { taskId: string; state: 'running' | 'done' | 'stopped' } }
  | { kind: 'task'; title: string; agentType?: string; summary?: string; actions?: number }
  | { kind: 'image'; source: 'viewed' | 'tool' | 'generated'; image: ImageRef; caption?: string }
  | { kind: 'tool'; name: string; server?: string; input?: string; output?: string; images?: ImageRef[] }
  | { kind: 'notice'; level: 'info' | 'warning' | 'error';
        code: 'auth' | 'rate_limit' | 'retry' | 'compaction' | 'refusal' | 'denied' | 'model_switched'
            | 'mcp_failed' | 'session_restored' | 'session_lost' | 'other';
        text: string; retry?: { attempt: number; max: number; inMs: number } }
  | { kind: 'unknown'; raw: unknown }
);

interface PlanStep { id: string; text: string; activeText?: string; status: 'pending' | 'active' | 'done' }

// Картинка никогда не едет по ленте в base64. Адаптер сохраняет байты в attachments/<sha256>.<ext>
// (одинаковые картинки — один файл), в ленте и в сыром логе остаётся ссылка. Превью делает main process.
interface ImageRef { id: string; mime: string; width?: number; height?: number;
  path?: string;                         // файл в проекте, если картинка оттуда
  remoteUrl?: string }                   // картинка по ссылке из Markdown — грузится только по клику

type Interaction =
  | { kind: 'approval'; id: string; itemId?: string;
      action: { type: 'command' | 'file_write' | 'network' | 'mcp' | 'other';
                title: string; command?: string; paths?: string[]; host?: string; reason?: string };
      choices: ('allow_once' | 'allow_session' | 'deny')[] }
  | { kind: 'question'; id: string;
      questions: { id: string; header: string; text: string; multi: boolean; allowFreeText: boolean;
                   secret?: boolean; options: { label: string; description?: string; preview?: string }[] }[] }
  | { kind: 'plan_approval'; id: string; plan: string }                  // режим «сначала план»
  | { kind: 'form'; id: string; server: string; title: string;         // форма от MCP-сервера
      fields: { id: string; label: string; type: 'text' | 'number' | 'select' | 'boolean'; options?: string[]; required?: boolean }[] }
  | { kind: 'login'; id: string; server: string; url: string }           // MCP-сервер просит войти
  | { kind: 'merge'; id: string; from: string; to: string;             // слияние из чата задачи (merge_task)
      files: number; added: number; removed: number;
      blockers: ('dirty_base' | 'not_on_base' | 'conflicts' | 'no_changes')[];
      baseAhead: number; skaroChanges: string[]; conflicts: string[] };  // предупреждения и список конфликтов

interface AgentSession {
  events: AsyncIterable<TimelineEvent>;
  send(input: UserInput[]): Promise<void>;      // новый ход
  steer(input: UserInput[]): Promise<void>;     // дописать в текущий ход
  respond(interactionId: string, answer: ApprovalAnswer | QuestionAnswer): Promise<void>;
  setModel(model: string, effort?: string): Promise<void>;
  setPermissionMode(mode: 'ask' | 'auto' | 'full'): Promise<void>; // на лету
  rewind(toItemId: string): Promise<void>;      // откат к сообщению (файлы + история); повтор и редактирование — rewind + send
  compact(): Promise<void>;                     // сжать контекст сейчас
  interrupt(): Promise<void>;
  stopBackground(taskId: string): Promise<void>;
  close(): Promise<void>;
}

interface AgentModel { id: string; name: string; description: string; isDefault: boolean;
  efforts: { id: string; description?: string }[]; defaultEffort?: string; images: boolean }

interface AgentCommand { name: string; description: string; kind: 'command' | 'skill' } // меню «/»
```

- Статус задачи «Нужен ответ» = есть открытая `interaction` или `status: waiting`.
- `AgentError` — категория (`auth`, `limit`, `overloaded`, `network`, `context_overflow`, `refusal`, `other`) плюс исходный текст. Интерфейс выбирает по категории действие: войти, дождаться лимита, перезапустить.

---

## 4. Маппинг

### 4.1 Claude Code → каноническая модель

| Нативное | Каноническое |
|---|---|
| `system/init` | `session.started` |
| `stream_event` · `text_delta` / `thinking_delta` | `item.append` в `message` / `reasoning` |
| `assistant` · `text` | `message{role:agent}`; последний в ходе → `phase: final`, остальные → `commentary` |
| `assistant` · `thinking` / `redacted_thinking` | `reasoning` |
| `assistant` · `tool_use` | элемент по реестру, `status: running` |
| `user` · `tool_result` + `tool_use_result` | завершение: `done` / `failed` по `is_error`; `gitDiff` / `structuredPatch` → `diff`, `added`, `removed`; `stdout` + `stderr` → `output`; «Exit code N» из текста → `exitCode`, если распознан; `interrupted` → `interrupted`; `backgroundTaskId` → `background` |
| `parent_tool_use_id` | `parentId` |
| `TaskCreate` / `TaskUpdate` | адаптер держит список по `taskId` и шлёт `plan.updated` целиком (`subject` → `text`, `activeForm` → `activeText`, `deleted` → убрать шаг); в ленте вызовы не показываются |
| `TodoWrite` (старые модели) | `plan.updated` (снимок) |
| `AskUserQuestion` через `canUseTool` | `interaction.question`; ответ → `allow` + `updatedInput{questions, answers}` |
| прочий `canUseTool` | `interaction.approval`; `allow_once` → `allow`, `allow_session` → `allow` + сессионная suggestion, `deny` → `deny{message}` |
| `system/task_*`, `background_tasks_changed` | `task` / `command.background` |
| `tool_progress` | время у `running`-элемента |
| `system/api_retry` | `notice{retry}` (одна обновляемая строка) |
| `system/status: compacting`, `compact_boundary` | `notice{compaction}` |
| `system/permission_denied` | элемент → `declined` + `notice{denied}` |
| `system/model_refusal_*` | `notice{refusal}` |
| `rate_limit_event` | `limits` |
| `system/session_state_changed` | `status` |
| `result` | `usage` + `turn.completed`; исход — по `is_error` и `assistant.error`, **не по `subtype`** |
| служебные (хуки, плагины, память…) | только сырой лог |

Картинки (Claude Code): `Read` картинки → `explore/read` с `ImageRef` (посмотрел изображение); блок `image` в результате MCP → `tool.images`; `Bash` с `isImage` → `command` + `ImageRef`.

Реестр инструментов: `Read → explore/read`, `Glob → explore/list`, `Grep → explore/search`, `WebFetch → explore/fetch`, `WebSearch → explore/web`, `Edit|Write|NotebookEdit → file_change`, `Bash|PowerShell → command`, `TaskStop|Monitor → обновление background`, `Agent|Workflow → task`, `TaskCreate|TaskUpdate|TaskGet|TaskList|TodoWrite → plan`, `AskUserQuestion → question`, `ExitPlanMode → message{phase:plan}`, `mcp__skaro__* → карточка Skaro`, `mcp__* → tool{server}`, прочее → `tool`.

### 4.2 Codex → каноническая модель

| Нативное | Каноническое |
|---|---|
| `thread/started` / `thread/start` | `session.started` |
| `turn/started` / `turn/completed` | `turn.started` / `turn.completed` (`error.codexErrorInfo` → `AgentError`) |
| `userMessage` | `message{role:user}` |
| `agentMessage` + `delta` | `message{role:agent}`, `commentary|final_answer` → `commentary|final` |
| `reasoning` + дельты | `reasoning` (summary) |
| `commandExecution`, все `commandActions` — `read`/`search`/`listFiles` | `explore` (по действию) |
| `commandExecution` прочий + `outputDelta` | `command` (`outputLive: true`, `exitCode`, `durationMs`) |
| `fileChange` + `patchUpdated` | `file_change`, `+/−` считаем из diff |
| `turn/plan/updated` | `plan.updated` |
| `plan` | `message{phase:plan}` |
| `collabAgentToolCall`, `subAgentActivity` | `task` |
| `webSearch` | `explore/web` |
| `mcpToolCall{server:"skaro"}` | карточка Skaro |
| `imageView` | `explore/read` с `ImageRef` |
| `imageGeneration` | `image{source: generated}` (`savedPath` → `path`, `revisedPrompt` → `caption`); `failure` → `notice` |
| прочие `mcpToolCall`, `dynamicToolCall` | `tool`; блоки `image` / `inputImage` → `tool.images` |
| `hookPrompt`, `functionCallOutput`, `sleep` | `tool` |
| `contextCompaction`, `thread/compacted` | `notice{compaction}` |
| `item/commandExecution/requestApproval` | `approval{command}`: `accept` / `acceptForSession` / `decline` |
| `item/fileChange/requestApproval` | `approval{file_write}` |
| `item/permissions/requestApproval` | `approval{other}` |
| `item/tool/requestUserInput` | `question` (`isOther` → `allowFreeText`, `isSecret` → `secret`) |
| `mcpServer/elicitation/request` | `question` (простая форма) или отказ |
| `serverRequest/resolved` | `interaction.closed` |
| `thread/status/changed` | `status` |
| `thread/tokenUsage/updated` / `account/rateLimits/updated` | `usage` / `limits` |
| `error{willRetry}` | `notice{retry}` / `notice{error}` |
| `warning`, `configWarning`, `deprecationNotice` | `notice{warning}` (+ диагностика адаптера) |
| `thread/name/updated` | название чата |
| `turn/diff/updated` | не нужен (П5) |

---

### 4.3 Решения из раздела 7 и служебное: откуда данные

| Возможность | Claude Code | Codex |
|---|---|---|
| Живая строка (`activity`) | `stream_event`: начало блока `thinking` / `text` / `tool_use`; для правки путь берётся из частичного входа (`input_json_delta`) | `item/started` + дельты `reasoning` / `agentMessage`; `fileChange` в статусе `inProgress` |
| Заполненность контекста | `assistant.context_usage`, `getContextUsage()` | `thread/tokenUsage/updated` (`modelContextWindow`) |
| Агент сменил модель | `system/model_refusal_fallback` | `model/rerouted` |
| MCP-сервер не запустился | `system/init.mcp_servers[].status`, `mcpServerStatus()` | `mcpServer/startupStatus/updated` |
| MCP просит войти | статус сервера «нужна авторизация» | `mcpServer/oauth/login` |
| Форма от MCP | `onElicitation` | `mcpServer/elicitation/request` |
| Команда ждёт ввода | прямого сигнала нет: долгий запуск без вывода — только подсказка по таймеру | `item/commandExecution/terminalInteraction` |
| Сначала план | режим прав `plan`, одобрение — `ExitPlanMode` через `canUseTool` → `plan_approval` | элемент `plan` → `plan_approval`, одобрение — следующий ход |
| Откат | `rewindFiles()` + продолжение с нужного сообщения (`resumeSessionAt` / `forkSession`) | `thread/revert` |
| Режим прав на лету | `setPermissionMode()` | `approvalPolicy` / `sandbox` в следующем `turn/start` |
| Вход в агента | прототип (запасной вариант — инструкция) | `account/login` |
| Меню «/» | `supportedCommands()`, навыки из `system/init.skills` | `skills/list` |
| Слияние | инструмент MCP Skaro `merge_task` → `interaction{merge}` | то же |
| Восстановление | `resume` по `session_id`; не нашлось — `notice{session_lost}` | `thread/resume`; ошибка — `notice{session_lost}` |

## 5. Агентские блоки макетов: что есть в реальности

Разбор экранов «Задача» (лента запуска), «Чат» и модалки агента. Для каждого элемента — что приходит от агентов на самом деле и что поменять в макете.

### 5.1 Лента: элементы, которые нарисованы

| Элемент макета | Реальность | Что поменять |
|---|---|---|
| **Сообщение пользователя** | ок. Сообщение, отправленное во время работы, агент подхватывает не сразу: Claude — между шагами, Codex — через `steer`. Если хода нет, Codex отвергает `steer`, и сообщение становится новым ходом | Состояние «в очереди» (приглушённый пузырь с часами), пока агент его не подхватил |
| **Текст агента со ссылками** | Агенты отдают Markdown, пути — в `code`. Реплик в ходе много: промежуточные (Codex `commentary`, текст Claude между вызовами) и итоговый ответ | Промежуточные реплики — компактнее. «Скопировать» — только у итогового ответа. Ссылки на файлы, ADR и задачи делает Skaro; путь — ссылка, только если файл есть |
| **«Прочитал 6 файлов · поиск X»** | ок для обоих. Бывает и веб: `WebSearch` / `WebFetch` / `webSearch` | В ту же группу: «искал в сети», «открыл страницу». В раскрытии — пути с диапазонами строк, шаблоны поиска, запросы |
| **План агента n/m** | Есть у обоих, но появляется не всегда (только на многошаговых задачах) и обновляется много раз за запуск. У Claude у активного шага есть форма «Проверяю права…» | Одна карточка на запуск, обновляется на месте, **закреплена** (над полем ввода или сверху), а не стоит в потоке и не уезжает. Нет плана — нет карточки. Активный шаг — в форме `activeText` |
| **`✎ файл +a −r` → мини-diff** | Claude: одна правка = один вызов, по одному файлу бывают десятки правок подряд. `Write` — новый файл целиком. `+/−` есть не всегда. Codex: один элемент = несколько файлов с diff. Правка может быть отклонена или не применится (Claude не нашёл фрагмент) | Подряд идущие правки одного файла схлопывать в одну строку с суммой `+/−`. Отдельный вид для «создан / удалён / переименован». Состояния «отклонено» и «не применилось». Итоговый diff для слияния Skaro считает из git |
| **`$ команда ✓ 4с` / `✗ код 1`** | Codex: код выхода, длительность, живой вывод. Claude: кода выхода в структуре нет (только ✓/✗ и текст «Exit code N»), длительность мерит Skaro, вывод приходит только в конце, зато есть `description` — описание команды человеческим языком. Команда бывает прервана или ждёт разрешения | ✓/✗ всегда, номер кода — когда есть. `description` — подписью к моноширинной команде. Выполняется: живой вывод (Codex) или таймер (Claude). Длинный вывод — хвост и «показать всё». Состояния «прервана» и «ждёт разрешения» |
| **Карточка вопроса** | Claude: 1–4 вопроса за раз, у каждого заголовок-чип до 12 символов, 2–4 варианта с описанием, возможен множественный выбор и превью варианта (markdown/HTML), свой ответ — на конкретный вопрос. Codex: вопросы с заголовком, вариантами, флагами «свой ответ» и «секретный ввод» | Сейчас: один вопрос, одиночный выбор, свой ответ через общее поле. Нужно: несколько вопросов в одной карточке (шаги или стопка), заголовок-чип, чекбоксы для множественного выбора, «свой вариант» у каждого вопроса, маскированный ввод для секрета, превью варианта. Общее поле ввода при открытом вопросе — «ответить своими словами» на всю карточку |
| **Фоновая команда «в фоне · 2:14»** | Claude: `run_in_background`, события `task_*`, остановка `stopTask`. Фоновая команда живёт и после конца хода. Codex: фоновые терминалы | Кнопка «Остановить» на чипе, раскрытие в вывод. Skaro гасит оставшиеся фоновые задачи при закрытии сессии |
| **Поле ввода: +, модель, отправка/стоп** | Модель меняется между ходами у обоих. Картинки — нативно у обоих. Файлы и папки — это ссылка на путь (Codex `mention`, Claude — путь в тексте), а не загрузка | «Прикрепить папку / файл» = вставить ссылку на путь. Картинки — настоящее вложение, если модель их принимает |

### 5.2 Чего в макетах нет, а в реальности будет

| Событие | Когда | Вид |
|---|---|---|
| **Запрос разрешения** | Почти в каждом запуске. «Спрашивать» — на каждую правку и команду. «Авто в пределах задачи» — на всё за пределами worktree, сеть, установку пакетов. Строка «Разрешить установку stripe@17?» на доске макета — это и есть запрос разрешения, но карточки для него нет | Карточка в стиле вопроса: что (команда моноширинно, путь или хост), причина (если агент дал), кнопки «Разрешить» · «Разрешить до конца задачи» · «Запретить» и поле «почему» (текст уходит агенту). Задача — «Нужен ответ» |
| **Размышления** | Claude — блоки `thinking` (можно получать сводкой или не получать вовсе), Codex — summary рассуждений | Серая строка «Думал 12 с», по клику — приглушённый текст. Или не показывать (вопрос 7.1) |
| **Субагент** | Claude часто запускает субагентов для поиска по коду. Codex — collab-агенты | Строка «↳ Субагент: <описание> · 14 действий · 0:40», раскрывается во вложенную ленту |
| **Повтор запроса** | сбой или перегрузка API | Одна строка «Повтор 2 из 10 через 8 с», исчезает после успеха |
| **Лимит** | исчерпан лимит | Строка в ленте + баннер «Лимит до 18:00» |
| **Нет авторизации** | агент разлогинен | Баннер «Войдите в Claude Code / Codex» с инструкцией |
| **Остановлено** | нажат «Стоп» | Строка «Остановлено» в конце хода |
| **Сжатие контекста** | регулярно на длинных задачах | Разделитель «Контекст сжат» |
| **Отказ правилом** | действие запрещено настройками | Пометка у элемента «запрещено правилом» |
| **Прочие инструменты** | MCP-серверы пользователя и т.п. | Строка «⚙ имя» с раскрытием |
| **Конец хода** | каждый ход | Строка-итог: длительность, токены |
| **Изображения** | агент смотрит скриншоты и макеты, MCP-браузер делает скриншоты, Codex генерирует картинки, в Markdown агента встречаются ссылки на картинки | см. задание дизайнеру, раздел «Изображения». Локальные картинки показываются сразу, картинки по внешним ссылкам — только по клику: Skaro сам ничего наружу не запрашивает |

### 5.3 Модалка агента и параметры запуска

| Элемент макета | Реальность | Что поменять |
|---|---|---|
| Список моделей с пояснениями | Оба агента отдают список моделей с названием и описанием (Claude `supportedModels()`, Codex `model/list` с моделью по умолчанию и скрытыми) | Список и описания — от агента. Названия в макете — заглушки |
| Усилие: Низкое / Среднее / Высокое | Claude: до 5 уровней (`low … max`), набор зависит от модели. Codex: свой набор на модель, с описаниями и значением по умолчанию | Ползунок строится из уровней выбранной модели (2–5 шагов). Не поддерживает — скрыть |
| Режим прав (3 варианта) | «Спрашивать»: Claude `default` + `canUseTool`, Codex `approval: untrusted`. «Авто в пределах задачи»: Claude `acceptEdits` + песочница Bash (`autoAllowBashIfSandboxed`), Codex `workspace-write` + `on-request` — совпадение по смыслу. «Полный доступ»: Claude `bypassPermissions`, Codex `danger-full-access` + `never` | Тексты верны. На Windows песочница не держит границу ни у одного агента (раздел 9.1) — там команды подтверждаются (D-28) |
| Изоляция: ветка / текущая папка | Делает Skaro (git worktree), агенту это прозрачно | ок |
| Выбор агента Claude ↔ Codex внутри чата | Сессии агентов несовместимы: смена агента = новая сессия без памяти (максимум — текстовая выжимка чата) | Менять агента — только при создании чата. Внутри чата меняется только модель (решение 7.3) |

### 5.4 Чаты проекта: карточки предложений

- **Карточки создаёт наш MCP-сервер.** Агент вызывает `propose_tasks` / `propose_adr` / `write_doc`. Инструмент **сразу** отвечает агенту «предложение показано пользователю» и не держит ход, агент продолжает. Решение пользователя уходит агенту следующим сообщением («Создано 3 из 4 задач, „Возвраты“ отклонена»). Так в макете и нарисовано: карточки между репликами агента.
- Если бы инструмент ждал решения, ход висел бы, а чат считался бы «ждёт ответа». Так не делаем.
- Автоприменение документов: инструмент отвечает «применено», карточка показывает «Применено · Откатить».
- «Изменить» у ADR открывает редактор, итог уходит агенту так же.
- Сам вызов `mcp__skaro__*` в ленте не показывается, показывается карточка.
- **Чат = сессия агента** (Claude `session_id`, Codex thread), продолжение через `resume`. Название: Codex присылает `thread/name/updated`, для Claude Skaro формирует сам.
- **Чат проекта только читает код:** Claude — запрещены инструменты правки, Bash только read-only. Codex — `sandbox: read-only`.

### 5.5 Производные места: доска, обзор, проекты

- **«Последнее действие» одной строкой** (карточка доски, «Сейчас работают») берётся из последнего `running`-элемента ленты: `file_change` → «Правит X», `command` → «$ cmd», `explore` → «Читает X», `approval` → «Ждёт разрешения: cmd», `question` → текст вопроса, `message` → первая строка. Одинаково для обоих агентов.
- «3 файла +96 −12» — из git worktree.
- Время работы — таймер Skaro.

---

## 6. Транспорт и процессы

**Claude Code — Agent SDK с его собственным бинарником** (решение принято). Версия закреплена релизом Skaro: SDK и CLI одной версии и протестированы вместе, формат меняется только при нашем обновлении. Бинарник (~230 МБ) не кладётся в установщик, а докачивается при первом использовании Claude Code в Skaro. Настройки и авторизация — из общего `~/.claude`.

**Codex — `codex app-server`** (решение принято): закреплённая версия `@openai/codex` с докачкой. Проверка схемы (П7) остаётся как защита при обновлении закреплённой версии. Используем stdio и v2 с `experimentalApi` (D-29): без него нет вопросов агента, режима плана и субагентов.

**Процессы.**
- Один процесс агента на сессию: запуск задачи или чат. Живёт в main process, stderr — в лог запуска.
- Падение процесса → `turn.completed{failed}` с категорией и «Перезапустить». Продолжение — `resume` / `thread/resume` по сохранённому `nativeSessionId`.
- Закрытие Skaro во время ожидания ответа: Claude — `defer` через хук `PreToolUse`, Codex — восстановление из thread. Открытая `interaction` хранится в AppDb и показывается снова.
- Дельты склеиваются в main process и уходят в renderer пачками (~30–60 раз в секунду), а не по токену.

---

## 7. Решения по отображению (23.09.2026)

1. Размышления агента показываются (свёрнутой строкой, раскрываются по клику).
2. Лента субагента раскрывается внутри его строки.
3. Смена агента в существующем чате запрещена. Внутри чата меняется только модель.
4. Карточка плана закреплена над полем ввода.
5. Codex — закреплённая версия с докачкой, как Claude Code.
6. Поддерживаются откат к сообщению, повтор ответа и редактирование отправленного сообщения (Claude — откат файлов и `forkSession`, Codex — `thread/revert`, в worktree Skaro дополнительно страхует через git).
7. Поддерживается режим «сначала план»: агент изучает код, предлагает план и ждёт одобрения до правок.
8. Пользовательские настройки агентов (`~/.claude`, `~/.codex`: хуки, MCP-серверы, навыки, глобальные инструкции) подключаются к запускам Skaro.
9. Режим прав меняется на лету, без перезапуска (Claude `setPermissionMode`, Codex — политика на следующий ход).
10. Вход в агента из Skaro: Codex — через протокол (`account/login`), Claude Code — проверить прототипом, запасной вариант — инструкция.
11. Язык: названия и описания моделей и уровней усилия переводит Skaro (для незнакомых моделей — текст агента). Инструкции агенту требуют писать описания команд и вопросы на языке пользователя.

Задание дизайнеру по агентским блокам — [design-brief-agent-feed.md](design-brief-agent-feed.md), вторая итерация — [design-brief-2.md](design-brief-2.md).

---

## 8. Обновление версий агентов

### 8.1 Как часто меняются форматы (замер 23.09.2026, последние 90 дней)

| | Claude Code / Agent SDK | Codex |
|---|---|---|
| Релизы | 77 версий SDK (~6 в неделю), 25 из них без изменений API | 35 релизов |
| Изменения протокола | 80 добавлений, 20 изменений поведения, 2 удаления, 58 исправлений | 250 коммитов в схему app-server protocol (~3 в день), в основном добавления |
| Набор инструментов | 20 → 43 за 4 месяца (2.1.138 → 2.1.280) | — |

Итого: добавления — ежедневно, изменения поведения — несколько раз в месяц, поломки совместимости — единицы за квартал.

Серьёзные изменения за период (Claude Code):
- план переехал с `TodoWrite` на Task-инструменты, которые на новых моделях убраны из набора по умолчанию;
- картинки страниц PDF переехали внутрь `tool_result`;
- глубина вложенности субагентов по умолчанию снижена с 5 до 1;
- `initialize` всегда отдаёт `pending_permission_requests`;
- удалено поле `persistent` у `Monitor`.

### 8.2 Что происходит при изменении формата

| Что поменялось у агента | Что видит пользователь | Что делаем мы |
|---|---|---|
| Новое поле | ничего | ничего |
| Новое событие или инструмент | универсальная строка «⚙ …» в ленте | при желании — строка в реестре адаптера |
| Пропало необязательное поле | беднее отображение (например, нет `+/−`) | ничего или мелкая правка адаптера |
| Изменилось поведение (как `TodoWrite` → Task) | до нашего обновления — ничего (версия закреплена) | правка маппинга в адаптере: часы, иногда день-два; интерфейс не трогаем |
| Сломан управляющий протокол (разрешения, вопросы) | до нашего обновления — ничего | Claude — держит SDK Anthropic; Codex — отчёт по схеме показывает, что именно поменялось |

После правки адаптера старые запуски пересобираются из сырого потока (П2).

### 8.3 Процесс

1. **Версии закреплены** релизом Skaro: SDK вместе с бинарником Claude Code и `@openai/codex`. Бинарники докачиваются при первом использовании.
2. **Ночная канарейка:** свежие версии обоих агентов гоняются по записанным сценариям (П8) на тестовом аккаунте. Результат — отчёт о различиях канонического выхода, для Codex — ещё и различия схемы протокола.
3. **Плановое обновление** закреплённых версий раз в 2–4 недели. **Внеплановое** — при выходе новой модели (новые модели доступны только в новых версиях агентов) и если серверная сторона перестаёт поддерживать закреплённую версию.
4. **Обновление = отчёт канарейки + правки адаптера + прогон golden-тестов**, затем релиз Skaro.
5. **Диагностика у пользователя:** счётчик необработанных событий по типам и «Сообщить о проблеме с отображением» (экспорт сырых строк без содержимого файлов).

---

## 9. Результаты прототипа (этап 1, 24.09.2026)

Стенд — `apps/agent-probe`, записи — `fixtures/golden/<агент>/<сценарий>/` (`raw.jsonl` — сырой поток в обе стороны, `canonical.jsonl` — лента, `meta.json`). Golden-тесты адаптеров пересобирают ленту из сырого потока и сравнивают с записью (`pnpm test`). Машина — Windows 11, закреплены Agent SDK 0.3.281 (Claude Code 2.1.281) и Codex 0.156.1.

### 9.1 Открытые вопросы

**Вход в Claude Code из Skaro — возможен.** У закреплённого бинарника есть `claude auth login` (по умолчанию подписка, `--console`, `--sso`) и `claude auth status` (JSON: `loggedIn`, `authMethod`, `subscriptionType`). В API SDK входа нет. Skaro запускает бинарник с `auth login` (открывается браузер) и проверяет результат через `auth status`. Проверено вручную из терминала; запуск без терминала (из main process) проверить на этапе 2.

**Песочница на Windows — у обоих агентов не держит границу.**
- Claude Code: `sandbox.enabled` → сессия не стартует: «Windows sandbox is not active on this session (feature gate off)». Песочницы Bash на Windows в 2.1.281 нет.
- Codex, режим `elevated` (ставит десктопный Codex в `~/.codex/config.toml`): ни одна команда не запускается — `CreateProcessWithLogonW` с ошибкой 1909 (служебная учётка заблокирована), хотя `windowsSandbox/readiness` отвечает `ready`. Команда при этом не получает `item/completed`.
- Codex, режим `unelevated`: команды работают, но при `workspace-write` агент без запроса записал файл за пределы репозитория.
- Следствие: на Windows режим «Авто в пределах задачи» нельзя обещать как границу. Решение — D-28: самопроверка песочницы перед первым запуском; не держит — команды подтверждаются, правки внутри worktree нет. На macOS и Linux не проверялось.

**Настройки пользователя (`~/.claude`, `~/.codex`, D-25) подключаются по умолчанию** — и влияют на запуски:
- Claude: навыки, плагины и коннекторы claude.ai приходят в сессию; недоступный коннектор даёт предупреждение `mcp_failed` в каждой сессии.
- Codex: подхватываются MCP-серверы и инструменты пользователя (инструмент `node_repl` из его настроек падал в сценарии правки), режим песочницы Windows и **усилие по умолчанию** (у владельца — `xhigh`, из-за чего лимит подписки кончился за несколько сценариев).
- Следствие: Skaro явно задаёт на каждый запуск модель, усилие и режим прав, а не наследует их; сбои MCP пользователя показываются одной строкой, а не в каждой сессии.

**Докачка закреплённых бинарников — через npm-реестр.** Оба агента публикуют бинарники платформенными npm-пакетами с `dist.integrity` (sha512):
- Claude: `@anthropic-ai/claude-agent-sdk-<платформа>@<версия>` — один `claude(.exe)`, ~240 МБ.
- Codex: `@openai/codex@<версия>-<платформа>` — `codex(.exe)`, `rg`, служебные исполняемые файлы.
- Установщик (этап 2): скачать тарбол с `registry.npmjs.org`, проверить `integrity`, распаковать в данные приложения `agents/<агент>/<версия>/`. Путь передаётся в `pathToClaudeCodeExecutable` и в запуск `codex app-server`. Codex при запуске нужен ещё каталог `codex-path` в `PATH` (там `rg`).

### 9.2 Что подтвердилось и что нового

| Тема | Claude Code | Codex |
|---|---|---|
| Ошибка авторизации | синтетическое `assistant` «Not logged in» + `result` с `is_error` (как в 1.3) | 5 повторов по WebSocket, переход на HTTPS, ещё 5 повторов, затем 401; в ленте — одна строка повтора и ошибка `auth` |
| Сообщение в очереди | новый тип `command_lifecycle` (`queued` → `started` / `cancelled`, флаг `msg_lifecycle_v1`) — прямой сигнал для состояния «в очереди» | — |
| Живая строка | новые `system/task_summary` («Searching for assert») и `post_turn_summary` (итог хода) — готовый текст для живой строки и доски | дельты и `item/started` |
| План агента | Task-инструменты включаются через `allowedTools` (подгружаются через `ToolSearch`); на многошаговой задаче план строится и обновляется | модель `gpt-6-sol` на той же задаче `turn/plan/updated` не прислала — шаги шли текстом («Step 1/3 …»). Карточка плана у Codex появляется не всегда |
| Правки файлов | в режиме полного доступа агент правит файлы через shell (`sed`, `cat >>`) — такие правки не видны как `file_change`; подтверждает П5: изменения Skaro берёт из git | правка — несколько файлов в одном элементе; для нового файла `diff` — это само содержимое |
| Команды на Windows | инструмент `PowerShell` (и `Bash` в субагентах) | `pwsh -Command …`; `commandActions` почти всегда `unknown`, поэтому группа «прочитал N файлов» на Windows почти не собирается |
| Фоновая команда | после её завершения CLI **сам начинает новый ход** (новый `init` и `result`) — Skaro должен принимать ходы, начатые агентом | — |
| Прерывание | команда получает `tool_result` с текстом отказа, ход — `terminal_reason: aborted_*` | — |
| Откат | `rewindFiles` + перезапуск с `resume` / `resumeSessionAt` откатывает файлы и разговор | `thread/revert` откатывает **только разговор**, файлы остаются — откат файлов делает Skaro через git |
| «Сначала план» | план пишется в `~/.claude/plans/<имя>.md` (правка вне репозитория), затем `ExitPlanMode` через `canUseTool` → карточка одобрения | `collaborationMode: plan` (экспериментальный API): агент исследует код только на чтение и отдаёт элемент `plan`; запроса одобрения нет — Skaro показывает карточку сам, одобрение — следующий ход в режиме `default` с `workspaceWrite` |
| Вопросы | `AskUserQuestion` через `canUseTool`, ответ в `updatedInput.answers` по тексту вопроса | `item/tool/requestUserInput` (экспериментальный API) работает **только в режиме плана**: флаг `default_mode_request_user_input` в 0.156.1 выключен. Вне плана агент пишет вопрос текстом и ждёт элементами `sleep` по 30 с |
| Субагенты | `Agent` → `task`, элементы субагента с `parent_tool_use_id` | субагент — отдельный поток (`threadId`): элемент `subAgentActivity{agentThreadId}` в основном потоке, дальше события дочернего потока; `collabAgentToolCall{tool: wait}` — ожидание. Адаптер вкладывает события дочернего потока в строку субагента |
| Язык ответов | — | глобальные инструкции пользователя (`~/.codex/AGENTS.md`) действуют: агент отвечал по-русски на английские запросы (D-25) |
| Сжатие | `/compact` → `status: compacting` → `compact_boundary` | `thread/compact/start` → элемент `contextCompaction` (и дублирующее `thread/compacted`) |
| Изображения | `Read` картинки и вложение пользователя — байты в `attachments/` | `imageView` — путь; вложение `localImage` |

**Экспериментальный API Codex:** вопросы агента, режим «сначала план» и субагенты доступны только в нём. Проверено — работает; решение D-29: включаем, канарейка следит за экспериментальной частью.

### 9.3 Записанные сценарии

Оба агента: `read`, `edit`, `failing-command`, `background-command`, `agent-plan`, `question`, `question-plan`, `permission`, `subagent`, `interrupt`, `auth-error`, `compaction`, `image`, `plan-first`, `rewind`, `sandbox` (у Claude нет `question-plan`: вопросы работают в любом режиме). Codex записан с `--effort low` и `windows.sandbox="unelevated"`.

### 9.4 Адаптеры в полном объёме (этап 3)

Сессии живут в пакетах адаптеров (`ClaudeSession`, `CodexSession`) и реализуют `AgentSession`; стенд `apps/agent-probe` записывает golden-сессии через них же. Лента собирается из событий (`packages/timeline`, `Timeline`), у каждой golden-сессии есть снимок итоговой ленты (`timeline.json`).

- **Самопроверка песочницы (D-28) без вызова модели.** Claude: инициализация CLI с `sandbox.failIfUnavailable` — на Windows отказ «feature gate off» за ~3 с. Codex: `command/exec` в песочнице `workspaceWrite` пишет внутри рабочей папки и уровнем выше; на Windows сначала `elevated`, при неудаче — `unelevated` (команды запускаются, но подтверждаются).
- **Результат проверки меняется со временем.** Утром `elevated` у Codex не запускал команды (ошибка 1909 — блокировка служебной учётки), вечером держал границу. Проверку нужно повторять при запуске Skaro и после сбоя запуска команды, а не один раз.
- **Инструменты пользователя в песочнице `elevated`.** Команды выполняются от служебной учётки Windows: встроенный `rg.exe` из каталога пакета Codex не запускается («отказ в доступе»), `node` из профиля пользователя «не найден». Агент обходится PowerShell, но тесты и сборки проекта, которым нужны инструменты пользователя, в такой песочнице не работают. Установщик должен класть бинарники Codex туда, где у учётки песочницы есть чтение и запуск; для инструментов проекта нужно решение — какие каталоги открывать песочнице (этап 8).
- **Одобрение плана у Codex** адаптер открывает сам: после хода в режиме плана с элементом `plan` — карточка `plan_approval`; ответ — следующий ход (`default`, с правом записи) или доработка плана.
- **Заполненность контекста у Claude** считается из потока: токены последнего ответа модели (`message.usage`: вход, кэш, выход) к `contextWindow` модели из `result.modelUsage`.
- **Ответ раньше запроса.** Пользователь может ответить на карточку раньше, чем SDK вызовет `canUseTool`; сессия Claude держит такие ответы до вызова.
- **Устойчивость (П3)** проверяется тестами: синтетический мусор и golden-сессии с повреждёнными строками разбираются без исключений, неизвестные типы становятся элементами `unknown`.
