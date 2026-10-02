/** Startup and shutdown milestones on stdout, for slow launches on CI runners. */
export const trace = process.env['SKARO_TRACE']
  ? (step: string) => console.log(`[trace ${process.uptime().toFixed(2)}s] ${step}`)
  : () => {};
