import type { C4ReviewMethods } from '../../shared/c4-review';
import type { ChatCatalogMethods } from '../../shared/chat-catalog';
import type { C4Package, ConfigDefaults } from '@skaro/core';
import type { TimelineState, TimelineEvent, Item } from '@skaro/timeline';
import type { HistoryView, HistorySource, HistoryPage, HistoryOrigin } from '../../shared/history';
import type { ProposeC4Args, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { C4ProposalRecord } from '../c4-service';

export type ProposalItem = Extract<Item, { kind: 'proposal' }>;
export interface BackgroundMethods
  extends
    ReturnType<typeof import('./task-catalog-work').taskCatalogWork>,
    ChatCatalogMethods,
    C4ReviewMethods {
  'registry.session': (
    key: string,
    view:
      import('../../shared/ipc-sessions').ChatView | import('../../shared/ipc-sessions').TaskView,
  ) => void;
  'artifacts.milestones': (root: string) => Promise<import('../../shared/ipc').MilestoneInfo[]>;
  'tasks.stages': (
    file: string,
    projectId: string,
  ) => Promise<import('../../shared/ipc').StageInfo[]>;
  'tasks.list': (
    file: string,
    projectId: string,
    merging?: string,
  ) => Promise<import('../task-list-reader').TaskListSnapshot>;
  'overview.card': (projectId: string) => Promise<import('../../shared/ipc-sessions').ProjectCard>;
  'artifacts.setDocumentStatus': (
    root: string,
    kind: 'adr' | 'spec',
    id: string,
    status: import('@skaro/core').AdrStatus,
  ) => Promise<void>;
  'artifacts.writeDocumentBody': (root: string, path: string, body: string) => Promise<void>;
  'registry.migrate': () => void;
  'registry.query': (query: import('../../shared/project-catalog').ProjectQuery) => {
    source: import('../../shared/project-catalog').ProjectRange;
    cards: import('../../shared/ipc-sessions').ProjectCard[];
  };
  'registry.page': (
    source: import('../../shared/project-catalog').ProjectRange,
    start: number,
  ) => import('../../shared/ipc-sessions').ProjectCard[];
  'registry.card': (card: import('../../shared/ipc-sessions').ProjectCard) => void;
  'registry.refresh': () => void;
  'catalog.invalidate': (root: string, paths?: string[]) => void;
  'catalog.documents': (
    root: string,
  ) => Promise<import('../../shared/document-catalog').DocumentCatalog>;
  'catalog.documentPage': (
    root: string,
    kind: import('../../shared/document-catalog').DocumentKind,
    start: number,
  ) => Promise<import('../../shared/ipc-entities').DocEntry[]>;
  'catalog.document': (
    root: string,
    key:
      { path: string } | { kind: import('../../shared/document-catalog').DocumentKind; id: string },
  ) => Promise<import('../../shared/ipc-entities').DocEntry | undefined>;
  'read.certify': (source: HistorySource, path: string, subject: number) => Promise<void>;
  'read.peek': (
    owner: string,
    path: string,
    subject: number,
  ) => Promise<{ view: HistoryView; seq: number } | undefined>;
  'history.open': (
    ...args: Parameters<BackgroundMethods['history.restore']>
  ) => Promise<import('./history-transfer').HistoryTransfer>;
  'history.next': (token: string) => { items: TimelineState['items']; done: boolean };
  'history.close': (token: string) => void;
  'artifacts.requirements': (
    root: string,
    path: string,
  ) => Promise<ReturnType<typeof import('../../shared/task-requirements').requirementsOf>>;
  'read.match': (owner: string, signature: string) => HistoryView | undefined;
  'read.begin': (owner: string, signature: string, state: TimelineState) => string;
  'read.append': (id: string, items: TimelineState['items']) => void;
  'read.commit': (id: string, origins?: HistoryOrigin[], force?: boolean) => HistoryView;
  'read.origins': (owner: string, origins: HistoryOrigin[], force: boolean) => void;
  'read.cancel': (id: string) => void;
  'read.events': (
    owner: string,
    events: TimelineEvent[],
    signature: string,
    origin?: { id: string; seq: number },
  ) => HistoryView | undefined;
  'read.changes': (
    source: HistorySource,
    start: number,
  ) => import('../../shared/proposal-changes').ProposalChange[];
  'read.page': (source: HistorySource, start: number, limit: number) => HistoryPage;
  'read.find': (source: HistorySource, id: string) => number;
  'read.copy': (
    source: HistorySource,
    pending?: import('../../shared/history').HistoryPending[],
  ) => string;
  'c4.files': (projectId: string, itemId: string) => string[];
  'c4.file': (projectId: string, itemId: string, path: string, side: 'before' | 'after') => string;
  'c4.context': (
    root: string,
    defaults: ConfigDefaults,
    scope: SkaroScope,
    checkout: string,
  ) => Promise<ToolResult>;
  'artifacts.read': (root: string, path: string) => Promise<string>;
  'artifacts.document': (
    root: string,
    path: string,
  ) => Promise<import('@skaro/core').C4DocumentSnapshot>;
  'c4.list': (projectId: string, ownerId?: string) => C4ProposalRecord[];
  'c4.package': (projectId: string, itemId: string) => C4Package;
  'c4.save': (record: C4ProposalRecord) => void;
  'c4.prepare': (
    root: string,
    args: ProposeC4Args & { locale: string; codeRoot: string },
    scope: SkaroScope,
  ) => Promise<C4ProposalRecord>;
  'c4.prepareMigration': (
    root: string,
    locale: string,
    scope: SkaroScope,
  ) => Promise<C4ProposalRecord | undefined>;
  'c4.apply': (root: string, projectId: string, itemId: string) => Promise<void>;
  'c4.status': (root: string, projectId: string, itemId: string) => Promise<string>;
  'c4.content': (projectId: string, itemId: string, side: 'before' | 'after') => string;
  'history.restore': (
    path: string,
    startedAt: number,
    agent: string,
    projectId: string,
    required?: boolean,
  ) => Promise<{ timeline: TimelineState; seq: number; segments: number }>;
  'history.canonical': (
    path: string,
    scope: string,
  ) => Promise<{ timeline: TimelineState; seq: number }>;
  'artifacts.load': (
    root: string,
    defaults: ConfigDefaults,
    revision: number,
    summary?: boolean,
  ) => Promise<import('../project-artifact-memory').ArtifactSnapshot>;
}
