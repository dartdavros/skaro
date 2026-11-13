const SKARO_NOTE = /^(?:<skaro-note>[\s\S]*?<\/skaro-note>\s*)+/;

export function withSkaroNote(note: string, text: string): string {
  return note.trim() ? `<skaro-note>\n${note.trim()}\n</skaro-note>\n\n${text}` : text;
}

export function withoutSkaroNote(text: string): string {
  return text.replace(SKARO_NOTE, '');
}
