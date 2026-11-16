import type { ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Real system clipboard sources, including Explorer's CF_HDROP rather than a bitmap. */
export async function writeClipboardImage(
  app: ElectronApplication,
  path: string,
  source: 'png' | 'bitmap' | 'file-drop',
) {
  if (source !== 'png') {
    const literal = path.replaceAll("'", "''");
    const code =
      source === 'file-drop'
        ? `Add-Type -AssemblyName System.Windows.Forms; $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add('${literal}'); [System.Windows.Forms.Clipboard]::SetFileDropList($files)`
        : `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $image = [System.Drawing.Bitmap]::FromFile('${literal}'); try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }`;
    execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', code], {
      windowsHide: true,
      timeout: 30000,
    });
  }
  return app.evaluate(
    async ({ clipboard, ClipboardItem, nativeImage }, { path, source }) => {
      let image = nativeImage.createFromPath(path);
      if (image.isEmpty()) throw new Error('The real app icon is unavailable');
      if (source === 'png')
        await clipboard.write([
          new ClipboardItem({
            'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }),
          }),
        ]);
      if (source === 'bitmap') {
        const item = (await clipboard.read()).find((i) => i.types.includes('image/png'));
        const blob = await item?.getType('image/png');
        if (!blob || !('arrayBuffer' in blob)) throw new Error('Windows bitmap is unavailable');
        image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      }
      return { png: image.toPNG().toString('base64'), size: image.getSize() };
    },
    { path, source },
  );
}
