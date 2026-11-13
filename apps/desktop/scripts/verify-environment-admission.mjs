import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

await verifyDesktopWorkflow('environment-admission', {
  SKARO_ADMISSION_PRIOR: process.argv[2] ?? '',
});
