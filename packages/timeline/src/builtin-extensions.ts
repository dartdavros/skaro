/** Nonsecret persisted host policy, never inferred from remote MCP annotations. */
export interface BuiltinExtensionPolicy {
  name: string;
  revision: string;
  readOnly: boolean;
}
