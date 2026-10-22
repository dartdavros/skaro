import { HELP_CENTER_URL } from '../../../shared/app-shell';

export const ABOUT_LINKS = {
  help: HELP_CENTER_URL,
  site: 'https://skaro.dev',
  issues: 'https://github.com/dartdavros/skaro/issues',
  author: 'https://ermolaev.tech',
} as const;

export const ABOUT_RESOURCES = [
  { id: 'help', address: 'help.skaro.dev' },
  { id: 'site', address: 'skaro.dev' },
  { id: 'issues', address: 'github.com/dartdavros/skaro/issues' },
] as const;
