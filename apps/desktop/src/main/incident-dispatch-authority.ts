import {
  requireRemedyDispatch,
  type RemedyAction,
  type RemedyApproval,
  type RemedyPolicy,
} from '@skaro/core';

/** Expiry gates admission; an entered exact operation still checks live revocation and policy. */
export class IncidentDispatchAuthority {
  private readonly action: RemedyAction;
  private validatedAt?: number;
  private enteredAt?: number;
  constructor(action: RemedyAction) {
    this.action = action;
  }

  validate(
    current: RemedyAction,
    policy: RemedyPolicy,
    approval: RemedyApproval | undefined,
    now = Date.now(),
  ) {
    const at = this.time(now);
    requireRemedyDispatch(this.action, current, policy, approval, at);
    this.validatedAt = at;
  }

  enter() {
    this.enteredAt ??= this.validatedAt;
  }

  time(now = Date.now()) {
    return this.enteredAt ?? now;
  }

  acceptTransfer(at: number) {
    this.validatedAt = this.time(at);
  }
}
