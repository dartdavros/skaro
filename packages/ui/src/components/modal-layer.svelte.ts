let active = $state<HTMLElement>();
const refresh = () => {
  active = [...document.querySelectorAll<HTMLElement>('[data-modal-root]')].at(-1);
};
/** Match the actual DOM stacking order; a detail viewer owns Escape until it closes. */
export function observeModalLayer() {
  queueMicrotask(refresh);
  return () => queueMicrotask(refresh);
}
export const isTopModal = (root?: HTMLElement) => active === root;
