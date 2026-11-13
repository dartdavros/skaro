export interface CoordinatorDispatchState {
  enabled: boolean;
  revision: number;
}
export interface CoordinatorMigration {
  version: 1;
  controllerId: string;
  fingerprint: string;
  blocked: boolean;
  chats: number;
  runs: number;
  legacyIntentsStopped: number;
  ambiguousCommands: number;
  legacyBlockers: number;
  policy: 'confirm-default' | 'existing-owner-policy';
}
export interface CoordinationControlMethods {
  'coordinator.state': (projectId: string) => {
    dispatch: CoordinatorDispatchState;
    migration?: CoordinatorMigration;
  };
  'coordinator.setDispatch': (
    projectId: string,
    enabled: boolean,
    expectedRevision: number,
  ) => CoordinatorDispatchState;
}
