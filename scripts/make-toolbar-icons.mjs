// Generates the editor toolbar icons (media/toolbar/<name>-light.svg and -dark.svg).
// Run with `node scripts/make-toolbar-icons.mjs` after changing a drawing below.
import { mkdirSync, writeFileSync } from 'node:fs';

const THEMES = { light: { ink: '#424242', accent: '#388a34', mark: '#e0b000' }, dark: { ink: '#c5c5c5', accent: '#89d185', mark: '#f2cc60' } };
const stroke = (c) => `fill="none" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"`;
const text = (c, s, size = 11, weight = 700, x = 8, y = 12) =>
  `<text x="${x}" y="${y}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="${weight}" text-anchor="middle" fill="${c}">${s}</text>`;
const grid = (c) => `<rect x="1.5" y="2.5" width="10" height="9" ${stroke(c)}/><path d="M1.5 5.5h10M1.5 8.5h10M5 2.5v9M8.3 2.5v9" ${stroke(c)}/>`;

const ICONS = {
  undo: (t) => `<path d="M5 3.5 2.5 6 5 8.5" ${stroke(t.ink)}/><path d="M2.5 6H10a3.5 3.5 0 0 1 0 7H6.5" ${stroke(t.ink)}/>`,
  redo: (t) => `<path d="M11 3.5 13.5 6 11 8.5" ${stroke(t.ink)}/><path d="M13.5 6H6a3.5 3.5 0 0 0 0 7h3.5" ${stroke(t.ink)}/>`,
  cut: (t) => `<circle cx="4.5" cy="12" r="2" ${stroke(t.ink)}/><circle cx="11.5" cy="12" r="2" ${stroke(t.ink)}/><path d="M6 10.6 12 2M10 10.6 4 2" ${stroke(t.ink)}/>`,
  copy: (t) => `<rect x="5.5" y="5.5" width="8" height="9" rx="1" ${stroke(t.ink)}/><path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" ${stroke(t.ink)}/>`,
  paste: (t) => `<path d="M5 2.5H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1H11" ${stroke(t.ink)}/><rect x="5" y="1.5" width="6" height="2.5" rx=".5" ${stroke(t.ink)}/><path d="M5.5 7.5h5M5.5 10h5M5.5 12.5h3" ${stroke(t.ink)}/>`,
  compile: (t) => `<path d="M4 2.5v11l9-5.5z" fill="${t.accent}"/>`,
  'build-view': (t) => `<path d="M1.5 3v10l6-5z" fill="${t.accent}"/><path d="M7 3v10l6-5z" fill="${t.accent}"/><path d="M14.5 3v10" ${stroke(t.ink)}/>`,
  log: (t) => `<path d="M3.5 1.5h6l3 3v10h-9z" ${stroke(t.ink)}/><path d="M9.5 1.5v3h3M5.5 7.5h5M5.5 10h5M5.5 12.5h3" ${stroke(t.ink)}/>`,
  part: (t) => text(t.ink, '§', 14, 400, 8, 13),
  label: (t) => `<path d="M1.5 3.5v4.2l6.8 6.8 5.7-5.7-6.8-6.8H2.5a1 1 0 0 0-1 1z" ${stroke(t.ink)}/><circle cx="4.5" cy="5.5" r="1" fill="${t.ink}"/>`,
  'add-row': (t) => `${grid(t.ink)}<path d="M13 11.5v4M11 13.5h4" ${stroke(t.accent)}/>`,
  'delete-row': (t) => `${grid(t.ink)}<path d="M11 13.5h4" ${stroke('#d13438')}/>`,
  'add-column': (t) => `${grid(t.ink)}<path d="M14 2.5v4M12 4.5h4" ${stroke(t.accent)}/>`,
  'delete-column': (t) => `${grid(t.ink)}<path d="M12 4.5h4" ${stroke('#d13438')}/>`,
  highlight: (t) => `<rect x="1" y="9.5" width="14" height="4.5" fill="${t.mark}" opacity=".85"/>${text(t.ink, 'ab', 10, 700, 8, 12.5)}`,
  comment: (t) => text(t.ink, '%', 13, 700, 8, 12.5),
};

mkdirSync('media/toolbar', { recursive: true });
for (const [name, draw] of Object.entries(ICONS)) {
  for (const [theme, colors] of Object.entries(THEMES)) {
    writeFileSync(`media/toolbar/${name}-${theme}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${draw(colors)}</svg>\n`);
  }
}
console.log(`wrote ${Object.keys(ICONS).length * 2} icons`);
