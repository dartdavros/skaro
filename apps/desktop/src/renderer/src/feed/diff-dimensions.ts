import type { DiffLine } from './diff-model';

/** Match the existing monospace line layout, including CSS tab stops and its sign/gap. */
export function diffDimensions(node: HTMLElement, lines: readonly DiffLine[]) {
  const line = node.querySelector<HTMLElement>('.fd-diff-line');
  const sign = line?.querySelector<HTMLElement>('.sign');
  if (!line || !sign) return undefined;
  const style = getComputedStyle(line);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const space = context.measureText(' ').width;
  const tab = Number.parseFloat(style.tabSize) * (style.tabSize.endsWith('px') ? 1 : space);
  let widest = 0;
  for (const entry of lines) {
    let width = 0;
    const parts = entry.text.split('\t');
    for (const [index, part] of parts.entries()) {
      if (index) width = (Math.floor(width / tab) + 1) * tab;
      width += context.measureText(part).width;
    }
    widest = Math.max(widest, width);
  }
  const offset =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.columnGap) +
    Number.parseFloat(getComputedStyle(sign).width);
  const separator = node.querySelector<HTMLElement>('.fd-diff-sep');
  const separatorStyle = separator ? getComputedStyle(separator) : undefined;
  const separatorHeight = separatorStyle
    ? Number.parseFloat(separatorStyle.height) +
      Number.parseFloat(separatorStyle.marginTop) +
      Number.parseFloat(separatorStyle.marginBottom)
    : 0;
  return {
    width: widest + offset,
    lineHeight: Number.parseFloat(style.lineHeight),
    separatorHeight,
  };
}
