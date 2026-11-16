import type { PickedFile } from '../../../shared/ipc';

interface PasteAttempt {
  image: Promise<PickedFile | undefined>;
  claimed: boolean;
}

/** A screen-clip can return focus to the feed; never intercept another editor or dialog. */
export function pasteTargetsComposer(event: KeyboardEvent | ClipboardEvent, root?: HTMLElement) {
  if (event.defaultPrevented || !root?.checkVisibility()) return false;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="alertdialog"]',
    )
  )
    return false;
  return !document.querySelector(
    'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  );
}

/** Windows screen clips can reach the native clipboard without a usable DOM File. */
export function createComposerPaste(options: {
  add: (image: PickedFile) => void;
  pending: (change: number) => void;
  sending: () => boolean;
}) {
  let keyboard: PasteAttempt | undefined;

  function nativeAttempt(): PasteAttempt {
    return {
      image: window.skaro.invoke('files.pasteImage').catch((error: unknown) => {
        console.error('Clipboard image read failed:', error);
        return undefined;
      }),
      claimed: false,
    };
  }

  function onkeydown(event: KeyboardEvent): void {
    if (
      options.sending() ||
      event.altKey ||
      event.shiftKey ||
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== 'v'
    )
      return;
    const attempt = nativeAttempt();
    keyboard = attempt;
    options.pending(1);
    void attempt.image
      .then((image) => {
        // The paste event owns the image when Chromium delivers it. Otherwise native paste
        // still attaches the screen clip; text continues through the normal textarea path.
        if (!attempt.claimed && image) options.add(image);
      })
      .finally(() => {
        if (keyboard === attempt) keyboard = undefined;
        options.pending(-1);
      });
  }

  async function onpaste(event: ClipboardEvent): Promise<void> {
    // Snapshot the File handles while Chromium's DataTransfer is still readable.
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (files.length) event.preventDefault();
    if (options.sending()) return;
    const attempt = keyboard ?? nativeAttempt();
    attempt.claimed = true;
    keyboard = undefined;
    options.pending(1);
    try {
      const native = await attempt.image;
      if (native) options.add(native);
      // Explorer file paste has no native bitmap. Keep all supplied files and deduplicate
      // in the composer using the stored content identity, including a bitmap/file pair.
      for (const file of files) {
        if (native && files.length === 1) continue;
        const image = await window.skaro.invoke(
          'files.pasteImage',
          new Uint8Array(await file.arrayBuffer()),
        );
        if (image) options.add(image);
      }
    } catch (error) {
      console.error('Pasted image could not be stored:', error);
    } finally {
      options.pending(-1);
    }
  }

  return { onkeydown, onpaste };
}
