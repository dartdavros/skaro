/** Source-bound RUN receipts from BuildKit SolveStatus JSON; logs and arbitrary names are discarded. */
export function managedBuildProgress(commands: string[]) {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const steps = commands.map((body, index) => ({
    instruction: index + 1,
    cached: false,
    observed: false,
    vertex: '',
    body: normalize(`RUN ${body}`),
  }));
  let pending = '',
    bytes = 0;
  function vertex(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const record = value as {
      digest?: unknown;
      name?: unknown;
      cached?: unknown;
      completed?: unknown;
      error?: unknown;
    };
    if (typeof record.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(record.digest)) return;
    if (typeof record.name !== 'string') return;
    const name = normalize(record.name).replace(/^\[[^\]]+\]\s*/, '');
    const matches = steps.filter((step) => step.body === name);
    // A missing cached field means false in Go's bool/omitempty; unknown types are never accepted.
    if (
      matches.length !== 1 ||
      typeof record.completed !== 'string' ||
      !Number.isFinite(Date.parse(record.completed)) ||
      record.error ||
      (record.cached !== undefined && typeof record.cached !== 'boolean')
    )
      return;
    const step = matches[0]!;
    if (step.vertex && step.vertex !== record.digest)
      throw new Error('managed_build_progress_identity_changed');
    step.vertex = record.digest;
    step.cached = record.cached === true;
    step.observed = true;
  }
  function line(text: string) {
    if (!text.trim()) return;
    const event: unknown = JSON.parse(text);
    if (!event || typeof event !== 'object') return;
    const vertices = (event as { vertexes?: unknown }).vertexes;
    if (vertices === undefined) return; // Statuses/logs/warnings carry no RUN completion proof.
    if (!Array.isArray(vertices)) throw new Error('managed_build_progress_unknown_vertices');
    for (const value of vertices) vertex(value);
  }
  return {
    accept(chunk: Buffer) {
      bytes += chunk.length;
      if (bytes > 8 * 1024 ** 2) throw new Error('managed_build_progress_limit');
      pending += chunk.toString('utf8');
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (Buffer.byteLength(pending) > 128 * 1024) throw new Error('managed_build_progress_limit');
    },
    finish() {
      if (pending.trim()) line(pending);
      pending = '';
      return steps.map(({ instruction, cached, observed, vertex }) => ({
        instruction,
        cached,
        observed,
        vertex,
      }));
    },
  };
}
