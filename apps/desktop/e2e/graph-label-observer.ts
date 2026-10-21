import type { Page } from '@playwright/test';

type Point = { x: number; y: number };
declare global {
  interface Window {
    graphDrawing: { labels: (Point & { text: string })[]; nodes: Point[] };
  }
}

/** Observe genuine canvas drawing without replacing rendering or application data. */
export async function observeGraphLabels(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.graphDrawing = { labels: [], nodes: [] };
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect;
    proto.clearRect = function (...args) {
      if (this.canvas.classList.contains('sigma-labels')) window.graphDrawing.labels = [];
      if (this.canvas.classList.contains('graph-effects')) window.graphDrawing.nodes = [];
      return clear.apply(this, args);
    };
    const text = proto.fillText;
    proto.fillText = function (value, x, y, maxWidth) {
      if (this.canvas.classList.contains('sigma-labels'))
        window.graphDrawing.labels.push({ text: value, x, y });
      if (maxWidth === undefined) return text.call(this, value, x, y);
      return text.call(this, value, x, y, maxWidth);
    };
    const arc = proto.arc;
    proto.arc = function (...args) {
      if (this.canvas.classList.contains('graph-effects')) {
        const [x, y, radius] = args;
        if (radius === 9 || radius === 21 || radius === 29)
          window.graphDrawing.nodes.push({ x, y });
      }
      return arc.apply(this, args);
    };
  });
}

export async function drawnGraphNames(page: Page, names: string[]): Promise<string[]> {
  return page.evaluate(
    (names) =>
      names.filter((name) =>
        window.graphDrawing.labels.some((label) => name.startsWith(label.text)),
      ),
    names,
  );
}
