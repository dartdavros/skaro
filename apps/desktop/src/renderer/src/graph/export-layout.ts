import LayoutWorker from '../graph-preview/layout.worker?worker';
import type { PreviewGraph } from '../graph-preview/projection';

export async function layoutForExport(graph: PreviewGraph, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!graph.order) return;
  const worker = new LayoutWorker();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Graph export layout timeout')), 60000);
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      worker.onerror = () => reject(new Error('Graph export layout failed'));
      worker.onmessage = (event: MessageEvent<{ id: string; x: number; y: number }[]>) => {
        try {
          if (event.data.length !== graph.order) throw new Error('Invalid graph export layout');
          for (const node of event.data) {
            if (!Number.isFinite(node.x) || !Number.isFinite(node.y))
              throw new Error('Invalid graph export coordinates');
            graph.mergeNodeAttributes(node.id, { x: node.x, y: node.y });
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      worker.postMessage({
        nodes: graph.mapNodes((id, node) => ({ id, x: node.x, y: node.y })),
        edges: graph.mapEdges((id, _edge, source, target) => ({ id, source, target })),
      });
    });
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    clearTimeout(timer);
    worker.terminate();
  }
}
