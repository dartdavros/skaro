import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
const selected = Object.fromEntries(
  ['SKARO_RC3_CACHE_PROJECT', 'SKARO_RC3_CACHE_PHASE'].map((key) => [key, process.env[key]]),
);
if (
  selected.SKARO_RC3_CACHE_PROJECT !== 'b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b' ||
  ![
    'buildkit-initialization-recovery',
    'buildkit-created-recovery',
    'buildkit-stopped-recovery',
    'buildkit-usage-recovery',
  ].includes(selected.SKARO_RC3_CACHE_PHASE)
)
  throw new Error('Exact owner-approved BuildKit initialization recovery scope required');
await verifyDesktopWorkflow('cache-buildkit-reconciliation', selected);
