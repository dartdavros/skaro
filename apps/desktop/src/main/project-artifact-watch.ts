import { statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { SKARO_DIR, type ArtifactStore } from '@skaro/core';

/** Follow creation/replacement of .skaro as well as edits inside the current directory. */
export function watchProjectArtifacts(
  root: string,
  store: ArtifactStore,
  onChange: () => void,
): () => void {
  let parent: FSWatcher | undefined;
  let stopArtifacts: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const attach = (): void => {
    stopArtifacts?.();
    stopArtifacts = undefined;
    if (closed) return;
    try {
      if (statSync(join(root, SKARO_DIR)).isDirectory()) {
        stopArtifacts = store.watch(() => {
          if (!closed) onChange();
        });
      }
    } catch {
      // An existing project may not have .skaro yet, or it may have just been removed.
    }
  };

  try {
    // Subscribe before inspecting .skaro so its first creation cannot fall between the two.
    parent = watch(root, (_event, name) => {
      if (closed || (name && name.toString() !== SKARO_DIR)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        attach();
        if (!closed) onChange();
      }, 20);
    });
    parent.on('error', () => parent?.close());
  } catch {
    // A missing/inaccessible project is handled by the project's normal missing-folder state.
  }
  attach();

  return () => {
    closed = true;
    clearTimeout(timer);
    parent?.close();
    stopArtifacts?.();
  };
}
