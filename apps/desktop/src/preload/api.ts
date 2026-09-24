/** API exposed to the renderer as `window.skaro`. The renderer has no Node access. */
export interface SkaroApi {
  /** `process.platform` of the host: `win32`, `darwin`, `linux`. */
  readonly platform: string;
}
