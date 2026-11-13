import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

await verifyDesktopWorkflow('archiagent', {
  SKARO_AG1_PHASE: process.argv[2] ?? 'inspect',
  SKARO_AG1_CASE: process.argv[3] ?? '',
  SKARO_AG1_COMMAND: process.argv[4] ?? '',
  SKARO_AG1_PRIOR_COMMAND: process.argv[5] ?? '',
});
