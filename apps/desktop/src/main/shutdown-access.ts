/** The closing renderer may recover its state and control its window, never start project work. */
export function allowedDuringShutdown(method: string): boolean {
  return [
    'app.shutdownState',
    'app.shutdownPainted',
    'app.shutdownNow',
    'window.minimize',
    'window.toggleMaximize',
    'window.isMaximized',
    // Renderer startup needs these bounded, read-only values after a reload.
    'agents.catalog',
    'app.getLocale',
  ].includes(method);
}
