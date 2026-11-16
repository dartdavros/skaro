import { clipboard, nativeImage } from 'electron';
import type { AttachmentStore } from '@skaro/core';
import type { PickedFile } from '../shared/ipc';

/** Paste-event bytes also cover Explorer file drops, which are not native bitmap clipboard data. */
export async function saveClipboardImage(
  attachments: AttachmentStore,
  captured?: Uint8Array,
): Promise<PickedFile | undefined> {
  let bytes = captured;
  if (
    bytes !== undefined &&
    (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024)
  )
    throw new Error('Invalid pasted image payload');
  if (bytes === undefined) {
    const item = (await clipboard.read()).find((entry) => entry.types.includes('image/png'));
    if (!item) return;
    const blob = await item.getType('image/png');
    if (!('arrayBuffer' in blob)) return;
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) throw new Error('The pasted image could not be decoded');
  const { width, height } = image.getSize();
  const ref = attachments.save({
    base64: image.toPNG().toString('base64'),
    mime: 'image/png',
    width,
    height,
  });
  return { path: attachments.file(ref), kind: 'image', image: ref };
}
