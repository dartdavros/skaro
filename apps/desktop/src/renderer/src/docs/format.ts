// Formatting buttons of the document editor (Documents mockup): wrap the selection or prefix
// the line, then put the selection where the user continues typing.

import { t } from '@skaro/ui';

export type Format = 'bold' | 'italic' | 'heading' | 'list' | 'code' | 'link' | 'table';

export interface Edit {
  text: string;
  start: number;
  end: number;
}

export function applyFormat(kind: Format, value: string, a: number, b: number): Edit {
  const sel = value.slice(a, b);
  const put = (ins: string, start: number, end: number): Edit => ({
    text: value.slice(0, a) + ins + value.slice(b),
    start,
    end,
  });
  const wrap = (mark: string, placeholder: string): Edit => {
    const x = sel || placeholder;
    const start = a + mark.length;
    return put(mark + x + mark, start, start + x.length);
  };
  switch (kind) {
    case 'bold':
      return wrap('**', t('docs.fmt.text'));
    case 'italic':
      return wrap('_', t('docs.fmt.text'));
    case 'code':
      return wrap('`', t('docs.fmt.codeText'));
    case 'link': {
      const x = sel || t('docs.fmt.text');
      const start = a + x.length + 3;
      return put(`[${x}](url)`, start, start + 3);
    }
    case 'heading':
    case 'list': {
      const line = value.lastIndexOf('\n', a - 1) + 1;
      const prefix = kind === 'heading' ? '## ' : '- ';
      return {
        text: value.slice(0, line) + prefix + value.slice(line),
        start: a + prefix.length,
        end: b + prefix.length,
      };
    }
    case 'table': {
      const col = t('docs.fmt.column');
      const ins = `${a && value[a - 1] !== '\n' ? '\n' : ''}| ${col} | ${col} |\n|---|---|\n| | |\n`;
      return put(ins, a + ins.length, a + ins.length);
    }
  }
}
