import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
await verifyDesktopWorkflow('resource-recovery', {
  SKARO_RC4_PHASE: process.argv[2] ?? 'inspect',
  SKARO_RC4_CASE: process.env.SKARO_RC4_CASE ?? '',
  SKARO_RC4_PREFLIGHT: process.env.SKARO_RC4_PREFLIGHT ?? '',
});
