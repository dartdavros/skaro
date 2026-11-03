import { mount, unmount } from 'svelte';
import { toBlob } from 'html-to-image';
import type { C4Model, C4View } from '@skaro/core/c4-view';
import { graphBounds } from './viewport';
import { layoutC4 } from './layout';
import C4ExportScene from './C4ExportScene.svelte';
import { exportHost, imageSize, painted, pngBytes } from '../diagram-export/image';

export async function c4Png(
  model: C4Model,
  view: C4View,
  source: HTMLElement,
): Promise<Uint8Array> {
  const graph = await layoutC4(model, view),
    bounds = graphBounds(graph);
  imageSize(Math.ceil(bounds.width), Math.ceil(bounds.height));
  await document.fonts.ready;
  const host = exportHost(source, Math.ceil(bounds.width), Math.ceil(bounds.height));
  host.classList.add('c4-canvas');
  let component: ReturnType<typeof mount> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('C4 export render timeout')), 15000);
      try {
        component = mount(C4ExportScene, {
          target: host,
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
    return pngBytes(
      await toBlob(host, {
        pixelRatio: 2,
        skipAutoScale: true,
        // The live export host is outside the viewport; the image clone starts at its origin.
        style: { position: 'relative', left: '0', top: '0', margin: '0', transform: 'none' },
        backgroundColor: getComputedStyle(source).getPropertyValue('--sk-bg').trim(),
        filter: (element) =>
          !(element instanceof Element) || !element.classList.contains('svelte-flow__attribution'),
      }),
    );
  } finally {
    if (component) await unmount(component);
    host.remove();
  }
}
