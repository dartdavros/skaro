// Shared OS ownership implementation, also used by the bundled runtime adapter.
export {
  processBirth,
  processBirthSync,
  stopOwnedProcess,
} from '@skaro/agent-runtime/process-identity';
export type { ProcessIdentity, OwnedProcess } from '@skaro/agent-runtime/process-identity';
