/** Controller validation failed before recording consent or invoking any external operation. */
export class DecisionNotDispatched extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
