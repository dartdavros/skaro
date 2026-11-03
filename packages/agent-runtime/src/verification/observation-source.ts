/** Skaro acceptance calls do not change the browser. A later call to its MCP host can. */
export function sameObservationHost(source: string, laterTool: string) {
  const parts = source.split('__');
  return parts.length >= 3 && parts[0] === 'mcp' && laterTool.startsWith(`mcp__${parts[1]}__`);
}
