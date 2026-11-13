import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

const project = 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b';
if (
  process.env.SKARO_RC3_CACHE_PROJECT !== project ||
  process.env.SKARO_RC3_CACHE_PHASE !== 'dependencies'
)
  throw new Error('Explicit owner-selected Stolovka cache/dependencies verification is required');
await verifyDesktopWorkflow('cache', {
  SKARO_RC3_CACHE_PROJECT: project,
  SKARO_RC3_CACHE_PHASE: 'dependencies',
});
