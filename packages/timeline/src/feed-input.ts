const SKARO_NOTE = /^(?:<skaro-note>[\s\S]*?<\/skaro-note>\s*)+/;

export function withSkaroNote(note: string, text: string): string {
  return note.trim() ? `<skaro-note>\n${note.trim()}\n</skaro-note>\n\n${text}` : text;
}

export function withoutSkaroNote(text: string): string {
  return text.replace(SKARO_NOTE, '');
}

/** Host context delivery has no owner-authored message to display. Raw history remains intact. */
export function isSkaroContextInput(text: string): boolean {
  const prefix = SKARO_NOTE.exec(text)?.[0];
  return (
    prefix?.includes('<skaro-note>\ncontext_update: ') === true &&
    withoutSkaroNote(text).trim() === ''
  );
}
