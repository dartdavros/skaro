import type { ChatSummary, ProjectCard } from '../../../shared/ipc';
import { importReview, importSource } from '../demo-import';
import type { PreviewHandlers } from './bridge-contract';
import {
  projects,
  projectSettings,
  chats,
  emit,
  MOCK_LOGO,
  mockProject,
  addMock,
  getTabs,
  setTabs,
} from './bridge-state';

export const projectsHandlers = {
  'projects.list': () => projects,
  'projects.pickFolder': () => '/Users/dev/code/shop-api',
  'projects.inspect': (path) => ({
    path,
    name: path.split('/').pop() ?? path,
    exists: true,
    git: true,
    branch: 'main',
  }),
  'projects.defaultParent': () => '/Users/dev/code',
  'projects.add': (path) => addMock(path),
  'projects.create': (parent, name) => addMock(`${parent}/${name}`),
  'projects.remove': (id) =>
    void projects.splice(
      projects.findIndex((p) => p.id === id),
      1,
    ),
  'projects.overview': () => {
    const now = Date.now();
    const zero = { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 };
    const cards: ProjectCard[] = [
      {
        id: 'p1',
        name: 'Shop API',
        path: '/Users/dev/code/shop-api',
        missing: false,
        branch: 'main',
        milestone: { id: 'M02', title: 'Платежи', done: 3, total: 8 },
        counts: { ...zero, working: 2, needs: 1, blocked: 2 },
        running: [
          {
            id: 'T-014',
            title: 'Интеграция с эквайрингом',
            agent: 'claude-code',
            model: 'claude-opus-5',
          },
          { id: 'T-017', title: 'Идемпотентность платежей', agent: 'codex', model: 'gpt-6-astra' },
        ],
        agent: 'claude-code',
        activeAt: now - 4 * 60_000,
      },
      {
        id: 'p2',
        name: 'Blog Engine',
        path: '/Users/dev/code/blog-engine',
        missing: false,
        branch: 'main',
        milestone: { id: 'M04', title: 'Редактор постов', done: 5, total: 9 },
        counts: { ...zero, review: 2, blocked: 1 },
        running: [],
        agent: 'codex',
        activeAt: now - 26 * 60_000,
      },
      {
        id: 'p3',
        name: 'Skaro Landing',
        path: '/Users/dev/code/skaro-landing',
        missing: false,
        branch: 'main',
        milestone: { id: 'M03', title: 'Документация', done: 6, total: 6 },
        counts: zero,
        running: [],
        agent: 'claude-code',
        activeAt: now - 190 * 60_000,
      },
      {
        id: 'p4',
        name: 'Timetracker',
        path: '/Users/dev/code/timetracker',
        missing: false,
        branch: 'main',
        counts: zero,
        running: [],
        agent: 'codex',
        activeAt: now - 2 * 86_400_000,
      },
      {
        id: 'p5',
        name: 'Old Dashboard',
        path: '/Users/dev/archive/old-dashboard',
        missing: true,
        counts: zero,
        running: [],
        agent: 'claude-code',
        activeAt: now - 42 * 86_400_000,
      },
    ];
    return cards
      .filter((c) => projects.some((p) => p.id === c.id) || c.id === 'p4' || c.id === 'p5')
      .map((c) => {
        const p = projects.find((x) => x.id === c.id);
        return p ? { ...c, name: p.name, ...(p.logo ? { logo: p.logo } : {}) } : c;
      });
  },
  'project.rename': (id, name) => {
    const p = mockProject(id);
    if (name.trim()) p.name = name.trim();
    return { ...p };
  },
  'project.pickLogo': (id) => {
    const p = mockProject(id);
    p.logo = MOCK_LOGO;
    return { ...p };
  },
  'project.removeLogo': (id) => {
    const p = mockProject(id);
    delete p.logo;
    return { ...p };
  },
  'project.settings': () => ({ ...projectSettings }),
  'project.saveSettings': (_p, next) => void Object.assign(projectSettings, next),
  'import.scan': (paths) => paths.map((path) => importSource(path)),
  'import.start': (projectId) => {
    const chat: ChatSummary = {
      id: 'imp1',
      title: 'Импорт документации',
      agent: 'claude-code',
      archived: false,
      kind: 'import',
      live: false,
      updatedAt: Date.now(),
    };
    if (!chats.some((c) => c.id === chat.id)) chats.unshift(chat);
    emit('chats.changed', { projectId });
    return chat;
  },
  'import.review': () => importReview(),
  'import.openSource': () => undefined,
  'project.hasCode': () => !new URLSearchParams(location.search).has('nocode'),
  'projects.relocate': (id, path) => ({ id, name: path, path, missing: false }),
  'projects.openIn': () => undefined,
  'tabs.get': () => getTabs(),
  'tabs.set': (value) => setTabs(value),
} satisfies Pick<
  PreviewHandlers,
  | 'projects.list'
  | 'projects.pickFolder'
  | 'projects.inspect'
  | 'projects.defaultParent'
  | 'projects.add'
  | 'projects.create'
  | 'projects.remove'
  | 'projects.overview'
  | 'project.rename'
  | 'project.pickLogo'
  | 'project.removeLogo'
  | 'project.settings'
  | 'project.saveSettings'
  | 'import.scan'
  | 'import.start'
  | 'import.review'
  | 'import.openSource'
  | 'project.hasCode'
  | 'projects.relocate'
  | 'projects.openIn'
  | 'tabs.get'
  | 'tabs.set'
>;
