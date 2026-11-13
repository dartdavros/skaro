import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
let crashObserved = false;
await verifyDesktopWorkflow(
  'coordination-recovery',
  {
    SKARO_AC5_PHASE: process.argv[2] ?? 'inspect',
    SKARO_AC5_CASE: process.argv[3] ?? '',
    SKARO_AC5_PREFLIGHT: process.env.SKARO_AC5_PREFLIGHT ?? '',
  },
  {
    onMessage(message, child) {
      if (
        process.argv[2] !== 'crash-effect' ||
        message.stage !== 'ac5-physical-effect-before-result'
      )
        return;
      if (!Number.isSafeInteger(child.pid) || child.pid < 1)
        throw new Error('Missing owned verification PID');
      crashObserved = true;
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
      });
      writeFileSync(
        join(message.directory, 'crash-cut.json'),
        JSON.stringify(
          {
            directory: message.directory,
            operation: message.operation,
            terminatedOwnedPid: child.pid,
            status: result.status,
          },
          null,
          2,
        ),
      );
    },
    exitCode(code) {
      return process.argv[2] === 'crash-effect' ? (crashObserved ? 0 : 1) : code;
    },
  },
);
