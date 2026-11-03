import {
  EXPORT_MAX_PIXELS,
  EXPORT_MAX_SIDE,
  EXPORT_MAX_BYTES,
} from '../../../shared/diagram-export';

export function imageSize(width: number, height: number, scale = 2) {
  const w = Math.ceil(width * scale),
    h = Math.ceil(height * scale);
  if (
    ![w, h].every(Number.isFinite) ||
    w < 1 ||
    h < 1 ||
    w > EXPORT_MAX_SIDE ||
    h > EXPORT_MAX_SIDE ||
    w * h > EXPORT_MAX_PIXELS
  )
    throw new Error('diagram-export-image-size');
  return { width: w, height: h };
}
export function exportHost(source: HTMLElement, width: number, height: number): HTMLDivElement {
  if (!source.isConnected) throw new Error('Export view closed');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  // Stay in the same theme and fullscreen subtree without changing the live canvas.
  source.append(host);
  return host;
}
export const painted = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
export async function pngBytes(blob: Blob | null): Promise<Uint8Array> {
  if (!blob || !blob.size || blob.size > EXPORT_MAX_BYTES)
    throw new Error('diagram-export-file-size');
  return new Uint8Array(await blob.arrayBuffer());
}
export const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
export function exportName(...parts: (string | number)[]): string {
  return parts
    .map(
      (part) =>
        String(part)
          // eslint-disable-next-line no-control-regex -- Windows filenames cannot contain controls.
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .replace(/[. ]+$/g, '')
          .slice(0, 65) || 'diagram',
    )
    .join('-')
    .slice(0, 170);
}
