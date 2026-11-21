/**
 * Support for the modal sheet's scroll lock (globals.css, `html:has(dialog
 * .viewer-sheet:modal)`). The page reserves its scrollbar, and a scrim never
 * covers a reserved gutter, so the lock releases the gutter and adds the same
 * width as padding. The width has to be measured before the lock, while the
 * scrollbar still exists. Same contract as `ConfirmDialog`: the CSS reads
 * `--scrollbar-w`.
 */
const PROPERTY = "--scrollbar-w";

export function reserveScrollbarWidth(): void {
  const root = document.documentElement;
  root.style.setProperty(
    PROPERTY,
    `${Math.max(0, window.innerWidth - root.clientWidth)}px`,
  );
}

export function releaseScrollbarWidth(): void {
  document.documentElement.style.removeProperty(PROPERTY);
}
