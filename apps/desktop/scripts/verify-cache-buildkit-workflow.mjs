import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
const selected = Object.fromEntries(
  [
    'SKARO_RC3_CACHE_PROJECT',
    'SKARO_RC3_CACHE_PHASE',
    'SKARO_RC3_CACHE_SOURCE_SHA256',
    'SKARO_RC3_CACHE_RECIPE_SHA256',
  ].map((key) => [key, process.env[key]]),
);
if (
  selected.SKARO_RC3_CACHE_PROJECT !== 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b' ||
  selected.SKARO_RC3_CACHE_PHASE !== 'buildkit'
)
  throw new Error('Exact owner-approved BuildKit verification scope required');
await verifyDesktopWorkflow('cache-buildkit', selected);
