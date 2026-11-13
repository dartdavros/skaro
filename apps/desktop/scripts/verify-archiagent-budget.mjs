import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
await verifyDesktopWorkflow('archiagent-budget', { SKARO_AG1_CASE: process.argv[2] ?? '' });
