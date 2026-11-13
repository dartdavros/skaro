import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
await verifyDesktopWorkflow('c4-coordination', {
  SKARO_C42_PHASE: process.argv[2] ?? 'prepare',
  SKARO_C42_PREFLIGHT: process.env.SKARO_C42_PREFLIGHT ?? '',
  SKARO_C42_PREPARATION_CHAT: process.env.SKARO_C42_PREPARATION_CHAT ?? '',
});
