/** Data validation is an expected rejection, never evidence of a service failure. */
export type C4IssueCode =
  | 'invalid_data'
  | 'planned_parent'
  | 'planned_view_member'
  | 'missing_current_view'
  | 'code_path_not_file'
  | 'missing_code_path'
  | 'pending_package'
  | 'stale_review'
  | 'review_required';

export interface C4Issue {
  code: C4IssueCode;
  ids: string[];
  message: string;
  nextStep: string;
  path?: string;
}

export interface C4Diagnostic {
  category: 'c4_validation';
  stage: 'proposal' | 'review' | 'submission' | 'publication';
  issues: C4Issue[];
}

export const C4_REPAIR_STEP =
  'Read get_c4_context, correct the reported C4 data through an owner-approved propose_c4 package when needed, then call review_c4 again. Do not change implementation status or waive evidence to bypass validation. A validation rejection alone does not establish a Skaro service defect.';

export function c4Issue(
  message: string,
  code: C4IssueCode = 'invalid_data',
  ids: string[] = [],
  nextStep = C4_REPAIR_STEP,
): C4Issue {
  return { code, ids, message, nextStep };
}

/** Keep legacy message APIs while validators report typed facts at their source. */
export class C4Problems {
  readonly issues: C4Issue[] = [];
  push(...messages: string[]): number {
    return this.issues.push(...messages.map((message) => c4Issue(message)));
  }
  add(issue: C4Issue): void {
    this.issues.push(issue);
  }
}

export class C4ValidationError extends Error {
  readonly diagnostic: C4Diagnostic;
  constructor(issues: C4Issue[], stage: C4Diagnostic['stage'] = 'proposal') {
    super(issues.map((issue) => issue.message).join('\n'));
    this.name = 'C4ValidationError';
    this.diagnostic = { category: 'c4_validation', stage, issues };
  }
}
