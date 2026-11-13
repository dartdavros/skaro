import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

const project = 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b';
const phase = process.env.SKARO_RC3_CACHE_PHASE;
if (
  process.env.SKARO_RC3_CACHE_PROJECT !== project ||
  !['archive-sixth-preflight', 'archive-sixth-recovery'].includes(phase)
)
  throw new Error('Exact owner-selected archive recovery scope and phase required');
await verifyDesktopWorkflow('cache-archive', {
  SKARO_RC3_CACHE_PROJECT: project,
  SKARO_RC3_CACHE_PHASE: phase,
});
