import { BUILT_IN_DEFAULTS } from '../../../shared/ipc';
import type { PreviewHandlers } from './bridge-contract';
import { settings, agents } from './bridge-state';

export const systemHandlers = {
  'window.minimize': () => undefined,
  'window.toggleMaximize': () => undefined,
  'window.close': () => undefined,
  'window.isMaximized': () => false,
  'app.getLocale': () => (settings.get('ui.locale') as 'ru' | 'en' | undefined) ?? 'ru',
  'app.setLocale': (locale) => void settings.set('ui.locale', locale),
  'app.getSetting': (key) => settings.get(key) ?? null,
  'app.setSetting': (key, value) => void settings.set(key, value),
  'app.projectDefaults': () => ({
    ...BUILT_IN_DEFAULTS,
    ...(settings.get('defaults.project') as object),
  }),
  'app.setProjectDefaults': (value) => void settings.set('defaults.project', value),
  'app.version': () => '2.0.3',
  'app.checkUpdate': () => ({ current: '2.0.3' }),
  'app.pickApp': () => undefined,
  'agents.list': () => agents,
  'agents.refresh': () => agents,
  'agents.install': () => undefined,
  'agents.login': () => undefined,
  'agents.models': () => [
    {
      id: 'claude-fable-5-1',
      name: 'Fable 5.1',
      description: 'Максимальная глубина — медленнее и дороже',
      isDefault: false,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }],
      images: true,
    },
    {
      id: 'claude-opus-5',
      name: 'Opus 5',
      description: 'Для агентной разработки',
      isDefault: true,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
      defaultEffort: 'high',
      images: true,
    },
    {
      id: 'claude-sonnet-5',
      name: 'Sonnet 5',
      description: 'Баланс скорости и качества',
      isDefault: false,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
      images: true,
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Haiku 4.5',
      description: 'Быстрая и дешёвая, для простых правок',
      isDefault: false,
      efforts: [],
      images: false,
    },
  ],
  'agents.config': (agent) => ({
    dir: agent === 'codex' ? 'C:/Users/dev/.codex' : 'C:/Users/dev/.claude',
    mcp:
      agent === 'codex'
        ? []
        : [
            { name: 'github', state: 'ok', tools: 12 },
            { name: 'claude.ai Google Drive', state: 'needs_auth', tools: 0 },
            { name: 'linear', state: 'failed', tools: 0, error: 'spawn npx ENOENT' },
          ],
    skills: 4,
    hooks: 2,
  }),
  'agents.openConfigDir': () => undefined,
  'agents.commands': () => [
    { name: 'compact', description: 'Сжать историю разговора', kind: 'command' },
    { name: 'review', description: 'Ревью текущих изменений', kind: 'command' },
    { name: 'init', description: 'Описать проект в CLAUDE.md', kind: 'command' },
    { name: 'security-review', description: 'Проверить изменения на уязвимости', kind: 'command' },
    { name: 'test-runner', description: 'Навык · запуск и разбор тестов', kind: 'skill' },
  ],
  'files.suggest': (_p, _t, query) =>
    [
      'src/auth/',
      'src/auth/policy.ts',
      'src/auth/roles.ts',
      'src/auth/middleware.ts',
      'src/auth/policy.test.ts',
      'src/admin/role-guard.ts',
    ]
      .filter((p) => p.includes(query))
      .map((path) => ({ path, kind: path.endsWith('/') ? 'folder' : 'file' })),
  'files.exist': (_p, _t, paths) =>
    paths.filter((p) => p.startsWith('src/') || p.startsWith('docs/')),
  'files.open': () => undefined,
  'files.pick': (kind) =>
    kind === 'folder'
      ? [{ path: 'C:/Users/dev/Docs/shop', kind: 'folder' }]
      : [{ path: 'C:/Users/dev/Downloads/ТЗ-админка.docx', kind: 'file' }],
  'shell.openExternal': () => undefined,
} satisfies Pick<
  PreviewHandlers,
  | 'window.minimize'
  | 'window.toggleMaximize'
  | 'window.close'
  | 'window.isMaximized'
  | 'app.getLocale'
  | 'app.setLocale'
  | 'app.getSetting'
  | 'app.setSetting'
  | 'app.projectDefaults'
  | 'app.setProjectDefaults'
  | 'app.version'
  | 'app.checkUpdate'
  | 'app.pickApp'
  | 'agents.list'
  | 'agents.refresh'
  | 'agents.install'
  | 'agents.login'
  | 'agents.models'
  | 'agents.config'
  | 'agents.openConfigDir'
  | 'agents.commands'
  | 'files.suggest'
  | 'files.exist'
  | 'files.open'
  | 'files.pick'
  | 'shell.openExternal'
>;
