/** A body-level canvas sits above header stacking contexts and follows the scene. */
export function alignOverlay(canvas, anchor) {
  const rect = anchor.getBoundingClientRect();
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top - rect.height * 0.15}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}
