const ru = {
  open: 'Открыть Skaro',
  status: (working: number, waiting: number) => `В работе: ${working} · Требуют ответа: ${waiting}`,
  settings: 'Настройки',
  help: 'Центр помощи',
  update: 'Доступно обновление',
  quit: 'Выход',
  confirm: 'Выйти из Skaro?',
  detail: 'Агенты ещё работают или ожидают ответа. При выходе их работа будет остановлена.',
  cancel: 'Отмена',
  exit: 'Выйти',
};

const en: typeof ru = {
  open: 'Open Skaro',
  status: (working, waiting) => `Working: ${working} · Need an answer: ${waiting}`,
  settings: 'Settings',
  help: 'Help center',
  update: 'Update available',
  quit: 'Quit',
  confirm: 'Quit Skaro?',
  detail: 'Agents are still working or waiting for an answer. Quitting will stop their work.',
  cancel: 'Cancel',
  exit: 'Quit',
};

export const trayText = (locale: string) => (locale === 'ru' ? ru : en);
