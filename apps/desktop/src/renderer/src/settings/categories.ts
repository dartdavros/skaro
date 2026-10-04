// The categories of "Настройки" (Settings mockup): the left column, one shown at a time.

export type SettingsCategory = 'agents' | 'work' | 'projects' | 'notify' | 'appearance' | 'about';

/** Icon paths as drawn in the mockup (24×24, stroke). */
export const CATEGORIES: { id: SettingsCategory; icon: string }[] = [
  {
    id: 'agents',
    icon: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  },
  {
    id: 'work',
    icon: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a9 9 0 0 1-9 9M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  },
  {
    id: 'projects',
    icon: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  },
  {
    id: 'notify',
    icon: 'M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
  },
  {
    id: 'appearance',
    icon: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  },
  { id: 'about', icon: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z' },
];

/** The remembered category; an unknown value (an older build) opens "Агенты". */
export function category(value: unknown): SettingsCategory {
  return CATEGORIES.some((c) => c.id === value) ? (value as SettingsCategory) : 'agents';
}
