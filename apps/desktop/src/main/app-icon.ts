import { app, nativeImage } from 'electron';
import { join } from 'node:path';

/** The same supplied artwork for the dev window and packaged application. */
export function windowIcon() {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build');
  return nativeImage.createFromPath(join(root, 'icon.png'));
}
