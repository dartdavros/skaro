/** Uses the native Electron download flow; the main process supplies sanitized metadata only. */
export async function exportDiagnostics(): Promise<void> {
  const report = await window.skaro.invoke('diagnostics.export');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `skaro-diagnostics-${report.createdAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
