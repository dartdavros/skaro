/** Stable worker protocol, never inferred from a diagnostic sentence or a provider error. */
export const isIncidentOwnerPause = (cause: string, code: string) =>
  cause === 'owner-decision' && /^(explicit[-_])?owner[-_](pause|stop)(d)?$/.test(code);
