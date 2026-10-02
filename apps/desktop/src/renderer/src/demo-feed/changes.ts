import type { TimelineEvent } from '@skaro/timeline';
import { W, item } from './events';

/** Edits in every state, commands, an MCP tool, a notice and the agent plan. */
export function changes(): TimelineEvent[] {
  return [
    item({
      id: 'e1',
      kind: 'file_change',
      files: [
        {
          path: `${W}/src/auth/policy.ts`,
          change: 'update',
          added: 6,
          removed: 1,
          diff: "@@ -1,3 +1,8 @@\n import { Role } from './roles';\n \n-const ADMIN_ONLY = ['finance'];\n+export const policy = {\n+  admin:   ['*'],\n+  manager: ['orders:*', 'catalog:*'],\n+  support: ['orders:read'],\n+} satisfies Record<Role, string[]>;\n",
        },
      ],
      status: 'done',
    }),
    item({
      id: 'e2',
      kind: 'file_change',
      files: [
        {
          path: `${W}/src/auth/policy.ts`,
          change: 'update',
          added: 80,
          removed: 3,
          diff: '@@ -20,3 +20,80 @@\n+export function assertCan() {}\n',
        },
      ],
      status: 'done',
    }),
    item({
      id: 'e3',
      kind: 'file_change',
      files: [{ path: `${W}/src/auth/permissions.ts`, change: 'add', added: 120 }],
      status: 'done',
    }),
    item({
      id: 'e4',
      kind: 'file_change',
      files: [{ path: `${W}/src/auth/legacy-acl.ts`, change: 'delete' }],
      status: 'done',
    }),
    item({
      id: 'e5',
      kind: 'file_change',
      files: [
        {
          path: `${W}/src/admin/guard.ts`,
          change: 'move',
          movePath: `${W}/src/admin/role-guard.ts`,
        },
      ],
      status: 'done',
    }),
    item({
      id: 'e6',
      kind: 'file_change',
      files: [{ path: `${W}/src/admin/routes.ts`, change: 'update' }],
      status: 'declined',
    }),
    item({
      id: 'e7',
      kind: 'file_change',
      files: [{ path: `${W}/src/admin/menu.ts`, change: 'update' }],
      status: 'failed',
    }),
    item({
      id: 'c1',
      kind: 'command',
      command: 'npm run lint',
      output: '',
      outputLive: false,
      status: 'done',
    }),
    item({
      id: 'c2',
      kind: 'command',
      command: 'npm test -- policy',
      description: 'Запускает тесты политики доступа',
      output:
        ' RUN  v3.2  src/auth\n ✓ policy › admin видит все разделы\n ✓ policy › менеджер видит заказы\n ✗ policy › менеджер не видит финансы\n   expected true to be false\n ✓ policy › поддержка только читает\n Tests  1 failed | 11 passed (12)',
      outputLive: false,
      status: 'failed',
    }),
    item({
      id: 'c4',
      kind: 'command',
      command: 'npm run test:watch',
      output: ' WATCH  src/auth\n ✓ 12 tests passed\n Waiting for file changes…',
      outputLive: false,
      background: { taskId: 'bg1', state: 'running' },
      status: 'running',
    }),
    item({
      id: 'c5',
      kind: 'command',
      command: 'npm run e2e -- admin',
      output: '',
      outputLive: false,
      status: 'interrupted',
    }),
    item({
      id: 'tl1',
      kind: 'tool',
      name: 'get_issue',
      server: 'linear',
      input: '{ "id": "SHOP-212" }',
      output:
        '{"title":"Роли и доступы админки","state":"In Progress","labels":["auth","admin"],"assignee":null}',
      status: 'done',
    }),
    item({
      id: 'n1',
      kind: 'notice',
      level: 'warning',
      code: 'other',
      text: 'Файл .env.local в .gitignore — агент не видит его содержимое.',
      status: 'done',
    }),
    {
      t: 'plan.updated',
      steps: [
        { id: 'p1', text: 'Найти текущие проверки ролей', status: 'done' },
        { id: 'p2', text: 'Описать матрицу прав в policy.ts', status: 'done' },
        {
          id: 'p3',
          text: 'Проверить права в сервисном слое',
          activeText: 'Проверяю права в сервисном слое',
          status: 'active',
        },
        { id: 'p4', text: 'Покрыть матрицу тестами', status: 'pending' },
        { id: 'p5', text: 'Убрать проверки из middleware', status: 'pending' },
      ],
    },
  ];
}
