/** Bounded SSE framing across arbitrary UTF-8, CR/LF and network chunk boundaries. */
export async function* serverEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let event: string[] = [];
  let eventSize = 0;
  let total = 0;
  const aborted = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', aborted, { once: true });
  const line = (value: string): string | undefined => {
    if (!value) {
      const data = event.length ? event.join('\n') : undefined;
      event = [];
      eventSize = 0;
      return data;
    }
    if (value.startsWith('data:')) {
      const data = value.slice(value[5] === ' ' ? 6 : 5);
      eventSize += data.length;
      if (eventSize > 1_048_576) throw new Error('Model event exceeds the size limit');
      event.push(data);
    }
    return undefined;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      total += next.value?.byteLength ?? 0;
      if (total > 8_388_608) throw new Error('Model stream exceeds the size limit');
      pending += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      for (;;) {
        const index = pending.search(/[\r\n]/);
        if (index < 0 || (!next.done && pending[index] === '\r' && index === pending.length - 1))
          break;
        const data = line(pending.slice(0, index));
        const width = pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1;
        pending = pending.slice(index + width);
        if (data !== undefined) yield data;
      }
      if (pending.length > 1_048_576) throw new Error('Model event exceeds the size limit');
      if (next.done) break;
    }
    // SSE requires a blank line to dispatch an event; a torn final event is never accepted.
    if (pending.trim() || event.length)
      throw new Error('Model stream ended with an incomplete event');
  } finally {
    signal.removeEventListener('abort', aborted);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
