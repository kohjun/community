/** Every dismissal path must pass the same guard; declining keeps the mounted draft intact. */
export function mayCloseWriteDialog(
  dirty: boolean,
  busy: boolean,
  confirmDiscard: () => boolean,
): boolean {
  if (busy) return false;
  return !dirty || confirmDiscard();
}
