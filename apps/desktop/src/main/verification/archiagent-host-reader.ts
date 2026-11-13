import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { processBirth } from '../process-identity';

/** Real, read-only OS work; its confirmed exit is the release boundary, never a timer. */
export async function startArchiagentReader(file: string) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const fs = require('node:fs'), crypto = require('node:crypto');
    const bytes = fs.readFileSync(process.argv[1]);
    console.log(JSON.stringify({bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
    // Keep ownership until the controller acknowledges this real read result.
    process.stdin.once('data', () => process.exit(0));
    process.stdin.resume();
  `,
      file,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const exited = once(child, 'exit');
  let output = '',
    error = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    error += data;
  });
  try {
    await once(child, 'spawn');
    const pid = child.pid!;
    const birth = await processBirth(pid);
    assert(birth, 'The real reader process must have a verified birth identity');
    const deadline = Date.now() + 15000;
    while (!output.includes('\n') && child.exitCode === null && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(output.includes('\n') && !error, 'The admitted reader must actually read its source');
    const result = JSON.parse(output.trim()) as { bytes: number; sha256: string };
    let finished = false;
    return {
      pid,
      birth,
      result,
      async finish() {
        if (finished) return;
        assert.equal(await processBirth(pid), birth, 'Never signal a reused PID');
        child.stdin.end('\n');
        const [code] = await exited;
        assert.equal(code, 0);
        assert.equal(error, '');
        finished = true;
      },
    };
  } catch (failure) {
    // Signal only this child handle; never release its lease while the process is alive.
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited.catch(() => undefined);
    throw failure;
  }
}
