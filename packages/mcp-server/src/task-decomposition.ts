/** Shared task boundaries for project chats, imports and planning tool descriptions. */
export const TASK_DECOMPOSITION_RULES = [
  '- Default to one task for a small, coherent change. Use the fewest tasks that deliver complete, verifiable outcomes.',
  '- Keep related implementation, necessary tests, documentation and verification of the same outcome in that task. Files, technical layers, individual requirements, acceptance criteria and checklist steps are not task boundaries.',
  '- Split only for independently useful outcomes, a concrete benefit from parallel execution, or scope too large for one bounded agent session. Keep tightly coupled sequential work together; do not combine unrelated outcomes into a giant task.',
  '- Each task can require its own agent session, branch, worktree, dependency setup, environment and integration checks. Weigh that cost before adding a task; grouping tasks into a milestone does not share their checkout or environment.',
  '- Before proposing or saving multiple tasks, consolidate pieces of the same outcome and explain the concrete reason for each remaining split in task notes. Use as many checkable acceptance criteria as the outcome needs; never split to meet a criterion count or a target task count.',
  '- Acceptance criteria describe observable outcomes of owner-approved requirements. Put proposed verification methods, commands, environments and prerequisites in verification_notes, outside the acceptance checklist. Do not add release, production or live credential checks as criteria unless the requested outcome itself requires that environment.',
  '- Set requires_pull_request=true for a task whose implementation or verification needs a pull request. Skaro prepares its registered worktree at startup.',
  '- Check verification feasibility before proposing: use the affected project tests and documented real environments. Browser verification applies to changed UI or directly affected browser behavior. A live provider check is required only when the actual requirement or project policy calls for it. Identify the approved environment and access prerequisite up front. Do not invent gates, fixtures or substitute services.',
  '- Respect explicit user instructions about task boundaries. Do not silently regroup already created or accepted tasks; propose any replanning for owner approval.',
].join('\n');
