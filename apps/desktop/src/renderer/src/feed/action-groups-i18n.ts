import { addMessages } from '@skaro/ui';
import type { ActionKind } from '@skaro/timeline';

function captions(locale: 'ru' | 'en', labels: Record<ActionKind, [string, string, string]>) {
  const states = ['done', 'running', 'pending'];
  addMessages(
    locale,
    Object.fromEntries(
      Object.entries(labels).flatMap(([kind, texts]) =>
        texts.map((text, i) => [`feed.group.${kind}.${states[i]}`, text]),
      ),
    ),
  );
}

captions('ru', {
  file: ['Отредактировал файлы', 'Редактирует файлы', 'Редактирование файлов'],
  command: ['Выполнил команды', 'Выполняет команды', 'Выполнение команд'],
  read: ['Прочитал файлы', 'Читает файлы', 'Чтение файлов'],
  list: ['Просмотрел папки', 'Просматривает папки', 'Просмотр папок'],
  search: ['Выполнен поиск в файлах', 'Выполняет поиск в файлах', 'Поиск в файлах'],
  web: ['Выполнен поиск в интернете', 'Выполняет поиск в интернете', 'Поиск в интернете'],
  fetch: [
    'Открыл страницы в интернете',
    'Открывает страницы в интернете',
    'Открытие страниц в интернете',
  ],
  reconnect: ['Переподключение', 'Переподключение', 'Переподключение'],
  tool: ['Вызвал инструменты', 'Вызывает инструменты', 'Вызов инструментов'],
  task: ['Запустил субагентов', 'Субагенты работают', 'Запуск субагентов'],
  image: ['Посмотрел изображения', 'Смотрит изображения', 'Просмотр изображений'],
  generated: ['Создал изображения', 'Создаёт изображения', 'Создание изображений'],
});

captions('en', {
  file: ['Edited files', 'Editing files', 'File edits'],
  command: ['Ran commands', 'Running commands', 'Commands'],
  read: ['Read files', 'Reading files', 'File reads'],
  list: ['Listed folders', 'Listing folders', 'Folder listings'],
  search: ['Searched files', 'Searching files', 'File search'],
  web: ['Searched the internet', 'Searching the internet', 'Internet search'],
  fetch: ['Opened web pages', 'Opening web pages', 'Web pages'],
  reconnect: ['Reconnecting', 'Reconnecting', 'Reconnecting'],
  tool: ['Called tools', 'Calling tools', 'Tool calls'],
  task: ['Started subagents', 'Subagents working', 'Subagents'],
  image: ['Viewed images', 'Viewing images', 'Images'],
  generated: ['Generated images', 'Generating images', 'Image generation'],
});
