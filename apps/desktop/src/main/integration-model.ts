import type { ProjectCheck } from '@skaro/core';
import type { TaskResult } from './completion-store';
import type { AgentId, MergeProgress } from '../shared/ipc';

export interface IntegrationRequest {
  localChanges?: import('@skaro/core').LocalChangesSnapshot;
  projectId: string;
  taskId: string;
  purpose: 'dependencies' | 'publication';
  base: string;
  results: TaskResult[];
  baseResults?: TaskResult[];
  checks: ProjectCheck[];
  target?: string;
  partial?: boolean;
  message?: string;
  publish?: boolean;
}

export interface IntegrationOperation extends IntegrationRequest {
  /** Boundaries before/after staged local edits; local layers never enter the published commit. */
  publicationHead?: string;
  localIndexHead?: string;
  id: string;
  fingerprint: string;
  baseHead: string;
  worktree: string;
  head: string;
  cursor: number;
  commitIntent?: { before: string; head: string; tree: string; cursor: number; input?: string };
  state:
    | 'preparing'
    | 'resolving'
    | 'verifying'
    | 'ready'
    | 'applied'
    | 'failed'
    | 'stale'
    | 'paused'
    | 'waiting';
  conflicts: string[];
  needsVerification: boolean;
  attempts: number;
  worker?: string;
  /** Queue executor lease, acquired before the first asynchronous Git action. */
  executor?: string;
  nativeSessionId?: string;
  nativeAgent?: AgentId;
  /** The effort its agent session runs with, as the composer of the feed shows it. */
  nativeEffort?: string;
  verificationPlan?: ProjectCheck[];
  checkReplacements?: { replaces: string; check: ProjectCheck }[];
  shellFailureRecovered?: boolean;
  /** A merge plan without the saved checks of accepted results (D-45). */
  mergeChecks?: true;
  error?: string;
  verification?: { head: string; checks: ProjectCheck[]; completedAt: number };
  checkRuns?: {
    name: string;
    run: string;
    shell?: ProjectCheck['shell'];
    head: string;
    state: 'running' | 'passed' | 'failed';
    output?: string;
    error?: string;
  }[];
  sequence: number;
  updatedAt: number;
}

export class IntegrationPending extends Error {
  readonly operation: IntegrationOperation;
  constructor(operation: IntegrationOperation) {
    super(
      `Skaro is resolving integration ${operation.id} for ${operation.taskId}. ` +
        'The operation is saved; no manual Git work is required. Publication has not happened.',
    );
    this.operation = operation;
  }
}

/** The saved failure of a candidate; its journal already shows this error. */
export class IntegrationFailed extends Error {
  readonly operation: IntegrationOperation;
  constructor(operation: IntegrationOperation) {
    super(operation.error ?? 'Integration failed');
    this.operation = operation;
  }
}

type Participation = Pick<IntegrationOperation, 'taskId' | 'purpose' | 'results'>;

/**
 * The tasks whose chats show and control the operation. A merge has no chat of its own: it lives
 * in the chat of every task it merges. Preparing dependencies belongs to the prepared task only.
 */
export function integrationParticipants(op: Participation): string[] {
  return [
    ...new Set([
      op.taskId,
      ...(op.purpose === 'publication' ? op.results.map((result) => result.taskId) : []),
    ]),
  ];
}

export function participatesIn(op: Participation, taskId: string): boolean {
  return integrationParticipants(op).includes(taskId);
}

/** The newest candidate of the task, if it is in one of the states; an older one never answers. */
export function currentIntegration(
  operations: readonly IntegrationOperation[],
  taskId: string,
  states: readonly IntegrationOperation['state'][],
): IntegrationOperation | undefined {
  const op = operations.findLast((op) => op.state !== 'stale' && participatesIn(op, taskId));
  return op && states.includes(op.state) ? op : undefined;
}

/** How the merge of the accepted result of a task goes; nothing once published or stopped. */
export function mergeProgress(
  operations: readonly IntegrationOperation[],
  taskId: string,
): { progress: MergeProgress; operation: IntegrationOperation } | undefined {
  const operation = currentIntegration(operations, taskId, [
    'preparing',
    'resolving',
    'verifying',
    'waiting',
    'failed',
  ]);
  if (operation?.purpose !== 'publication') return undefined;
  const progress: MergeProgress =
    operation.worker || operation.executor
      ? 'running'
      : operation.state === 'waiting'
        ? 'needs_answer'
        : operation.state === 'failed'
          ? 'failed'
          : 'queued';
  return { progress, operation };
}

/** The candidate whose feed the chat of the task shows: its files are the ones the feed names. */
export function integrationCandidate(
  operations: readonly IntegrationOperation[],
  taskId: string,
): IntegrationOperation | undefined {
  return currentIntegration(operations, taskId, [
    'resolving',
    'verifying',
    'paused',
    'waiting',
    'failed',
  ]);
}

/** An integration turn works in the chat of the task with its own agent. */
export function integrationWorking(
  operations: readonly IntegrationOperation[],
  taskId: string,
): boolean {
  return operations.some((op) => participatesIn(op, taskId) && !!(op.worker || op.executor));
}

export function integrationQueueKey(op: Pick<IntegrationOperation, 'projectId' | 'id'>): string {
  return `${op.projectId}\n@integration:${op.id}`;
}

export function integrationEnvironmentKey(op: Pick<IntegrationOperation, 'projectId' | 'id'>) {
  return { projectId: op.projectId, taskId: `integration-${op.id}` };
}
