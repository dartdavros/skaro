/** Read bytes directly from a real terminal. No echo, shell history, argv, env or temp files. */
export function readCredential(signal) {
  const input = process.stdin;
  if (!input.isTTY || !input.setRawMode) throw new Error('A real terminal is required');
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const bytes = Buffer.alloc(16_384);
    let length = 0;
    const previousRaw = input.isRaw;
    const finish = (error) => {
      input.off('data', receive);
      input.off('end', ended);
      input.off('error', failed);
      signal.removeEventListener('abort', ended);
      input.setRawMode(previousRaw);
      input.pause();
      process.stderr.write('\n');
      const result = Buffer.from(bytes.subarray(0, length));
      bytes.fill(0);
      if (error) {
        result.fill(0);
        reject(error);
      } else resolve(result);
    };
    const ended = () => finish(new Error('Credential input cancelled'));
    const failed = () => finish(new Error('Credential input failed'));
    const receive = (chunk) => {
      try {
        for (const byte of chunk) {
          if (byte === 3 || byte === 4 || byte === 27) {
            ended();
            return;
          }
          if (byte === 13 || byte === 10) {
            finish();
            return;
          }
          if (byte === 8 || byte === 127) {
            if (length) bytes[--length] = 0;
            continue;
          }
          if (byte < 33 || byte > 126 || length === bytes.length) {
            finish(new Error('Invalid credential input'));
            return;
          }
          bytes[length++] = byte;
        }
      } finally {
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
      }
    };
    process.stderr.write('API key (hidden; Escape cancels): ');
    input.setRawMode(true);
    input.on('data', receive);
    input.once('end', ended);
    input.once('error', failed);
    signal.addEventListener('abort', ended, { once: true });
    input.resume();
  });
}
