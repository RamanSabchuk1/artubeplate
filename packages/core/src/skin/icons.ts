// The HUD's glyphs as SVG masks — drawn here, no icon font to host. Each glyph sits on a 24×24
// grid; the mask takes the ALPHA of whatever is painted, so the icon wears the element's
// `currentColor`. The class names are open-slot-ui's markup contract (`icon-*`). Heavy strokes and
// circled menu glyphs, in the style of the classic slot bar.

const svg = (body: string, stroke = 2.4, box = '0 0 24 24'): string =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${box}' fill='none' stroke='black' stroke-width='${stroke}' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`)}")`;

/** A glyph inside a ring (the ☰ menu's style). `body` is drawn on the 24-grid and shrunk to fit. */
const ringed = (body: string): string =>
  svg(`<circle cx='12' cy='12' r='10.6' stroke-width='1.9'/><g transform='translate(12 12) scale(0.6) translate(-12 -12)' stroke-width='3'>${body}</g>`);

/** The same, struck through: the stroke cuts a gap through the glyph so it reads at menu size. */
const ringedOff = (body: string): string =>
  svg(
    `<defs><mask id='cut'><rect width='24' height='24' fill='white'/><path d='M5 5l14 14' stroke='black' stroke-width='3.6'/></mask></defs>` +
      `<circle cx='12' cy='12' r='10.6' stroke-width='1.9'/>` +
      `<g mask='url(#cut)'><g transform='translate(12 12) scale(0.66) translate(-12 -12)' stroke-width='3'>${body}</g></g>` +
      `<path d='M5.2 5.2l13.6 13.6' stroke-width='1.7'/>`,
  );

// ↻ — a clockwise ring open at four-thirty, the head at three o'clock pointing down. It pokes a
// little past the 24-grid on the right, so the spin glyph draws on a 26-grid (see `spin` below).
const REDO = `<path d='M18.86 18.86A9.7 9.7 0 1 1 21.63 10.82' stroke-linecap='butt'/><path d='M24.61 10.45L22.21 15.58L18.65 11.18Z' fill='black' stroke='none'/>`;
// ⟳ with ▶ — two half-ring arrows chasing each other round a play triangle (the autoplay glyph).
const CYCLE = `<path d='M3.98 9.85A8.3 8.3 0 0 1 19.52 8.49' stroke-linecap='butt'/><path d='M21.97 7.35L20.92 11.48L17.08 9.63Z' fill='black' stroke='none'/><path d='M20.02 14.15A8.3 8.3 0 0 1 4.48 15.51' stroke-linecap='butt'/><path d='M2.03 16.65L3.08 12.52L6.92 14.37Z' fill='black' stroke='none'/>`;
const PLAY = `<path d='M10.2 9.2v5.6l4.7-2.8z' fill='black' stroke-width='1.2'/>`;
const SPEAKER = `<path d='M4 9.5h3.5L12 6v12l-4.5-3.5H4z' fill='black'/>`;
const NOTE = `<path d='M9 17.5V6l9.5-2v11.5'/><circle cx='6.6' cy='17.6' r='2.5' fill='black'/><circle cx='16.1' cy='15.6' r='2.5' fill='black'/>`;
const BOLT = `<path d='M13 2.5L5 13.2h6L10 21.5l8.5-11H12.4z' fill='black'/>`;
const BOLTS = `<path d='M9.2 3L3.4 12h4.2l-1 7.5 6.6-9.6H8.9z' fill='black'/><path d='M17.2 5l-4.5 7.2h3.3l-.8 6.8 5.4-8.3h-3.4z' fill='black'/>`;
const SLASH = `<path d='M4 4l16 16'/>`;
// ␣ on a keycap — SPACEBAR TO SPIN.
const SPACE = `<rect x='1.5' y='7' width='21' height='10' rx='2.4'/><path d='M7 11.2v2.3h10v-2.3'/>`;

export const ICONS: Record<string, string> = {
  menu: svg(`<path d='M0.5 2h23v4h-23zM0.5 10h23v4h-23zM0.5 18h23v4h-23z' fill='black' stroke='none'/>`),
  close: svg(`<path d='M5.5 5.5l13 13M18.5 5.5l-13 13'/>`, 3.2),
  'menu-close': svg(`<path d='M5 5l14 14M19 5L5 19'/>`, 4.2),
  spin: svg(REDO, 2.2, '-1 -1 26 26'),
  // A full square: the library sizes the slam-stop glyph itself (the square IS the glyph's size).
  stop: svg(`<rect x='1' y='1' width='22' height='22' rx='2.5' fill='black' stroke='none'/>`),
  autoplay2: svg(`${CYCLE}${PLAY}`, 2.1),
  play: svg(PLAY),
  'arrow-up': svg(`<path d='M5 15.5l7-7 7 7'/>`, 3),
  'arrow-down': svg(`<path d='M5 8.5l7 7 7-7'/>`, 3),
  plus: svg(`<path d='M12 4v16M4 12h16'/>`, 4),
  minus: svg(`<path d='M4 12h16'/>`, 4),
  'sound-on': svg(`${SPEAKER}<path d='M15.5 9a4.5 4.5 0 0 1 0 6'/><path d='M18 6.5a8 8 0 0 1 0 11'/>`),
  'sound-off': svg(`${SPEAKER}<path d='M16 9.5l5 5M21 9.5l-5 5'/>`),
  'music-on': svg(NOTE),
  'music-off': svg(`${NOTE}${SLASH}`),
  'turbo-on': svg(BOLT),
  'turbo-off': svg(`${BOLT}${SLASH}`),
  'super-turbo-on': svg(BOLTS),
  'super-turbo-off': svg(`${BOLTS}${SLASH}`),
  history: svg(`<path d='M3.5 12a8.5 8.5 0 1 0 2.5-6'/><path d='M3 3.5V7h3.5'/><path d='M12 7.5V12l3 2'/>`),
  'info-a': svg(`<circle cx='12' cy='12' r='9'/><path d='M12 11v6'/><circle cx='12' cy='7.6' r='1.2' fill='black' stroke='none'/>`),
  'info-b': svg(`<circle cx='12' cy='12' r='9'/><path d='M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7'/><circle cx='12' cy='17' r='1.1' fill='black' stroke='none'/>`),
  home: svg(`<path d='M4 11l8-7 8 7'/><path d='M6 10v10h12V10'/><path d='M10 20v-5h4v5'/>`),
  chip: svg(`<circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='4'/><path d='M12 3v3M12 18v3M3 12h3M18 12h3'/>`),
  coins: svg(`<ellipse cx='12' cy='7' rx='7' ry='3'/><path d='M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7'/><path d='M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5'/>`),
  fullscreen: svg(`<path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/>`),
  dots: svg(`<circle cx='5' cy='12' r='1.6' fill='black'/><circle cx='12' cy='12' r='1.6' fill='black'/><circle cx='19' cy='12' r='1.6' fill='black'/>`),
  /** Turn the phone, or make the window bigger: the screen under the HUD's floor (56×24). */
  floor: svg(
    `<rect x='3' y='5' width='10' height='16' rx='2'/><path d='M8 18h0.01'/><path d='M16 3.5a9.5 9.5 0 0 1 6 9'/><path d='M23.6 9.8l-1.6 2.9-2.9-1.6'/><path d='M34 9V4h5M34 4l6 6M52 15v5h-5M52 20l-6-6'/>`,
    2,
    '0 0 56 24',
  ),
};

/** The ☰ menu's glyphs: the same shapes, each inside a ring. */
export const MENU_ICONS: Record<string, string> = {
  'sound-on': ringed(`${SPEAKER}<path d='M15.5 9a4.5 4.5 0 0 1 0 6'/><path d='M18 6.5a8 8 0 0 1 0 11'/>`),
  'sound-off': ringed(`${SPEAKER}<path d='M16 9.5l5 5M21 9.5l-5 5'/>`),
  'music-on': ringed(NOTE),
  'music-off': ringedOff(NOTE),
  'turbo-on': ringed(BOLT),
  'turbo-off': ringedOff(BOLT),
  'super-turbo-on': ringed(BOLTS),
  'super-turbo-off': ringedOff(BOLTS),
  'spacebar-on': ringed(SPACE),
  'spacebar-off': ringedOff(SPACE),
  history: ringed(`<path d='M4.5 12a7.5 7.5 0 1 0 2.2-5.3'/><path d='M4.2 4.2v3.4h3.4'/><path d='M12 8v4l2.8 1.8'/>`),
  'info-a': ringed(`<path d='M12 10.5v7'/><circle cx='12' cy='6.2' r='1.6' fill='black' stroke='none'/>`),
  'info-b': ringed(`<path d='M12 10.5v7'/><circle cx='12' cy='6.2' r='1.6' fill='black' stroke='none'/>`),
  home: ringed(`<path d='M3.5 11.5L12 4l8.5 7.5'/><path d='M6 10v10h12V10'/>`),
  fullscreen: ringed(`<path d='M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'/>`),
};

/** `.icon-x { --ap-icon: url(...) }` rules for every glyph; menu rows use the ringed set. */
export const ICON_CSS = [
  ...Object.entries(ICONS)
    .filter(([name]) => name !== 'close')
    .map(([name, url]) => `.icon-${name}{--ap-icon:${url}}`),
  ...Object.entries(MENU_ICONS).map(([name, url]) => `.MainMenuItem .icon-${name},.MainMenu .icon-${name}{--ap-icon:${url}}`),
].join('\n');
