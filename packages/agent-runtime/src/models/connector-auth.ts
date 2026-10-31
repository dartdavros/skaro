import type { CredentialBinding, CredentialReference, ProcessAdmission } from '@skaro/timeline';
export interface ConnectorCredential {
  binding: CredentialBinding;
  reference: CredentialReference;
  admission: ProcessAdmission;
}
