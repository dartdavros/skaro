import { addMessages, t } from '@skaro/ui';
addMessages('ru', {
  'export.png': 'Экспорт PNG',
  'export.allC4': 'Экспорт всех диаграмм в PNG',
  'export.menu': 'Экспорт графа',
  'export.busy': 'Экспорт…',
  'export.current.png': 'PNG — текущее представление',
  'export.all.png': 'PNG — весь граф проекта',
  'export.current.gexf': 'GEXF — текущее представление',
  'export.all.gexf': 'GEXF — весь граф проекта',
  'export.imageSize':
    'Диаграмма превышает допустимый размер PNG. Для графа используйте GEXF или текущее представление.',
  'export.fileSize': 'Превышен допустимый объём экспорта.',
  'export.failed': 'Не удалось выполнить экспорт: {reason}',
  'export.batchFailed': 'Экспорт остановлен. Сохранено диаграмм: {n}. {reason}',
});
addMessages('en', {
  'export.png': 'Export PNG',
  'export.allC4': 'Export all diagrams as PNG',
  'export.menu': 'Export graph',
  'export.busy': 'Exporting…',
  'export.current.png': 'PNG — current view',
  'export.all.png': 'PNG — entire project graph',
  'export.current.gexf': 'GEXF — current view',
  'export.all.gexf': 'GEXF — entire project graph',
  'export.imageSize':
    'The diagram exceeds the PNG size limit. Export GEXF or the current view instead.',
  'export.fileSize': 'The export exceeds the size limit.',
  'export.failed': 'Export failed: {reason}',
  'export.batchFailed': 'Export stopped. Diagrams saved: {n}. {reason}',
});
export function exportError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes('diagram-export-image-size')) return t('export.imageSize');
  if (message.includes('diagram-export-file-size')) return t('export.fileSize');
  return t('export.failed', { reason: message });
}
