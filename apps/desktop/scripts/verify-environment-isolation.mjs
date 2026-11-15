import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

await verifyDesktopWorkflow('environment-isolation', {
  SKARO_ISOLATION_IN_PLACE_ONLY: process.argv.includes('--in-place-only') ? '1' : '',
  SKARO_ISOLATION_WORKTREE_ONLY: process.argv.includes('--worktree-only') ? '1' : '',
});
