import { mount, unmount } from 'svelte';
import { toCanvas } from 'html-to-image';
import type { C4Model, C4View } from '@skaro/core/c4-view';
import { EXPORT_MAX_PIXELS, EXPORT_MAX_SIDE } from '../../../shared/diagram-export';
import { graphBounds } from './viewport';
import { layoutC4 } from './layout';
import C4ExportScene from './C4ExportScene.svelte';
import { canvasBlob, exportHost, imageSize, painted, pngBytes } from '../diagram-export/image';

export async function c4Png(
  model: C4Model,
  view: C4View,
  source: HTMLElement,
): Promise<Uint8Array> {
  const graph = await layoutC4(model, view);
  const bounds = graphBounds(graph);
  const width = Math.ceil(bounds.width),
    height = Math.ceil(bounds.height);
  const scale = Math.min(
    2,
    EXPORT_MAX_SIDE / width,
    EXPORT_MAX_SIDE / height,
    Math.sqrt(EXPORT_MAX_PIXELS / (width * height)),
  );
  const output = imageSize(
    Math.max(1, Math.floor(width * scale)),
    Math.max(1, Math.floor(height * scale)),
    1,
  );
  await document.fonts.ready;
  const host = exportHost(source, width, height);
  const scene = document.createElement('div');
  scene.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
  host.append(scene);
  let component: ReturnType<typeof mount> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('c4-export-render')), 15000);
      try {
        component = mount(C4ExportScene, {
          target: scene,
          props: {
            graph,
            onready: () => {
              clearTimeout(timer);
              resolve();
            },
          },
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    await painted();
    const canvas = await toCanvas(scene, {
      width,
      height,
      canvasWidth: output.width,
      canvasHeight: output.height,
      pixelRatio: 1,
      skipAutoScale: true,
      filter: (element) =>
        !(element instanceof Element) || !element.classList.contains('svelte-flow__attribution'),
    });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('c4-export-render');
    if (graph.nodes.length) {
      let rendered = false;
      for (let y = 0; y < canvas.height && !rendered; y += 64) {
        const pixels = context.getImageData(
          0,
          y,
          canvas.width,
          Math.min(64, canvas.height - y),
        ).data;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i]) {
            rendered = true;
            break;
          }
        }
      }
      if (!rendered) throw new Error('c4-export-render');
    }
    const style = getComputedStyle(source);
    context.globalCompositeOperation = 'destination-over';
    context.scale(canvas.width / width, canvas.height / height);
    const tile = document.createElement('canvas');
    tile.width = tile.height = 24;
    const dots = tile.getContext('2d')!;
    dots.fillStyle = style.getPropertyValue('--sk-fill-32').trim();
    dots.beginPath();
    dots.arc(0.5, 0.5, 0.5, 0, Math.PI * 2);
    dots.fill();
    context.fillStyle = context.createPattern(tile, 'repeat')!;
    context.fillRect(0, 0, width, height);
    context.fillStyle = style.getPropertyValue('--sk-bg').trim();
    context.fillRect(0, 0, width, height);
    return pngBytes(await canvasBlob(canvas));
  } finally {
    if (component) await unmount(component);
    host.remove();
  }
}
