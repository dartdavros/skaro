/** Exact decimal accumulation for reported receipts; never estimates an unreported charge. */
export function sumReportedAmounts(values: readonly string[]): string {
  let total = 0n,
    scale = 0;
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid reported amount');
    const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
    if (!match) throw new Error('Invalid reported amount');
    const exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
      throw new Error('Reported amount exponent exceeds its limit');
    const fraction = match[2] ?? '';
    let coefficient = BigInt(match[1]! + fraction);
    const places = fraction.length - exponent;
    if (places < 0) coefficient *= 10n ** BigInt(-places);
    const nextScale = Math.max(0, places);
    if (nextScale > scale) {
      total *= 10n ** BigInt(nextScale - scale);
      scale = nextScale;
    }
    total += coefficient * 10n ** BigInt(scale - nextScale);
  }
  const digits = total.toString().padStart(scale + 1, '0');
  return scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '')
    : digits;
}
