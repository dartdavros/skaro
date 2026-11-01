import type {
  BuiltinModelConfiguration,
  Connection,
  CredentialBinding,
  CredentialReference,
  CredentialVault,
  Route,
} from '@skaro/timeline';

export interface ModelSettingsSnapshot {
  configuration: BuiltinModelConfiguration;
  protection: Awaited<ReturnType<CredentialVault['availability']>>;
  credentials: readonly { binding: CredentialBinding; reference: CredentialReference }[];
}
export interface ModelSettingsMethods {
  'models.settings': () => ModelSettingsSnapshot;
  'models.saveConnection': (
    revision: number,
    connection: Omit<Connection, 'credential'>,
    secret?: string,
  ) => BuiltinModelConfiguration;
  'models.saveRoute': (revision: number, route: Route) => BuiltinModelConfiguration;
  'models.remove': (
    revision: number,
    kind: 'connection' | 'route',
    id: string,
  ) => BuiltinModelConfiguration;
}
