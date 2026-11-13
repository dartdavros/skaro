/** Produced only by the environment executor before entering any lifecycle/build/start effect. */
export class EnvironmentNotDispatched extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

/** The owned shell has exited; failure is known, but partial Docker/data effects may remain. */
export class EnvironmentCommandFailed extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}
