// A readout that must fit its slot whatever the platform's font. The skin sizes values by length
// (`data-charcount`), but the same string is ~13% wider in one system font than in another, so a
// narrow slot (the stake's 90px box) can still spill under its neighbours. After every change of
// the text, of the slot's size and of the loaded fonts, this measures the text and shrinks its
// font just enough.

/** The width the text takes in layout pixels: the HUD's own scale and a running bump of the value
 *  (open-slot-ui pops a changed readout to 1.07) are transforms, divided back out. */
function textWidth(el: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
  return range.getBoundingClientRect().width / scale;
}

/**
 * Keep `el`'s text inside `slot`'s content box: its own CSS size first, smaller only when that
 * spills, never under `minPx`. A hidden slot (another layout's readout) is left alone. Returns
 * the disposer.
 */
export function fitToSlot(el: HTMLElement, slot: HTMLElement = el.parentElement ?? el, minPx = 8): () => void {
  let frame = 0;
  const fit = (): void => {
    frame = 0;
    el.style.removeProperty('font-size');
    if (slot.offsetWidth === 0 || el.offsetWidth === 0) return;
    const cs = getComputedStyle(slot);
    const room = slot.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const need = textWidth(el);
    if (need <= room) return;
    const px = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${Math.max(minPx, Math.floor(((px * room) / need) * 10) / 10)}px`;
  };
  const queue = (): void => {
    if (!frame) frame = requestAnimationFrame(fit);
  };
  const text = new MutationObserver(queue);
  text.observe(el, { childList: true, characterData: true, subtree: true });
  const size = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue);
  size?.observe(slot);
  // A web font that arrives after the fit changes the text's width but neither the text nor the slot.
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  fonts?.addEventListener?.('loadingdone', queue);
  queue();
  return () => {
    text.disconnect();
    size?.disconnect();
    fonts?.removeEventListener?.('loadingdone', queue);
    if (frame) cancelAnimationFrame(frame);
  };
}
