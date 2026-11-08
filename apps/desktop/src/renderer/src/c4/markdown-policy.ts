/** C4 diagrams belong to the C4 workspace, never to document or message previews. */
export function isC4Diagram(language: string, source: string): boolean {
  if (language === 'skaro-c4') return true;
  if (language !== 'mermaid') return false;
  const definition = source
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*\r?\n/, '')
    .replace(/^\s*%%[^\n]*(?:\n|$)/gm, '')
    .trimStart();
  return /^C4(?:Context|Container|Component|Dynamic|Deployment)\b/.test(definition);
}
