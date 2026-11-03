/** Do not expose an auth-token echo, including a value split across streaming text deltas. */
export class ModelSecretGuard {
  private pending = '';
  private readonly token: string;
  constructor(token: string) {
    this.token = token;
  }
  requireSafe(value: unknown): void {
    if (JSON.stringify(value)?.includes(this.token))
      throw new Error('Sensitive model response rejected');
  }
  text(value: string, final = false): string {
    this.pending += value;
    if (this.pending.includes(this.token)) throw new Error('Sensitive model response rejected');
    let keep = 0;
    if (!final)
      for (let size = Math.min(this.pending.length, this.token.length - 1); size > 0; size--) {
        if (this.pending.endsWith(this.token.slice(0, size))) {
          keep = size;
          break;
        }
      }
    const safe = this.pending.slice(0, this.pending.length - keep);
    this.pending = this.pending.slice(this.pending.length - keep);
    return safe;
  }
}
