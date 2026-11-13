import type { CoordinationOperation } from '@skaro/core';

/** The caller may inspect the durable operation; none of these errors authorizes a retry. */
export class CoordinationPending extends Error {
  readonly operation: CoordinationOperation;
  constructor(operation: CoordinationOperation) {
    super(`Project operation ${operation.id}: ${operation.evidence?.code ?? operation.state}.`);
    this.operation = operation;
  }
}
