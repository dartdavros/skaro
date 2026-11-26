/** Serializable task-graph proposal; snapshots detect edits between review and application. */
export interface ReplanTask {
  requiresPullRequest?: boolean;
  ref: string;
  id?: string;
  sources: string[];
  title: string;
  body: string;
  dependsOn: string[];
  milestone?: string;
  order: number;
  spec?: string;
}

export interface TaskReplanProposal {
  type: 'task_replan';
  key: string;
  requestFingerprint: string;
  title: string;
  before: string;
  after: string;
  taskIds: string[];
  tasks: ReplanTask[];
  rewired: { id: string; dependsOn: string[] }[];
  snapshot: { id: string; fingerprint: string }[];
  contextFingerprint: string;
}

/** Completed filesystem work in a durable replan operation; never an estimated percentage. */
export interface TaskReplanProgress {
  operation: 'apply' | 'revert';
  writes: number;
  totalWrites: number;
  removes: number;
  totalRemoves: number;
  error?: string;
}
