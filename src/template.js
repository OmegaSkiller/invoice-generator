// Node wrapper: inlines fonts + optional logo into the shared template (self-contained HTML for PDF).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR } from './core.js';
import * as T from './shared/template.js';

let fontCss;
function fonts() {
  if (fontCss) return fontCss;
  const dir = path.join(ROOT, 'node_modules/@fontsource-variable/inter/files');
  const face = (file, range) => {
    const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
    return `@font-face{font-family:'InterInv';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}`;
  };
  fontCss =
    face('inter-latin-wght-normal.woff2', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD') +
    face('inter-cyrillic-wght-normal.woff2', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116');
  return fontCss;
}

function logo() {
  for (const ext of ['svg', 'png', 'jpg', 'jpeg', 'webp']) {
    const f = path.join(DATA_DIR, `logo.${ext}`);
    if (fs.existsSync(f)) {
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return `<img class="logo" src="data:${mime};base64,${fs.readFileSync(f).toString('base64')}" alt="">`;
    }
  }
  return '';
}

export const renderInvoiceHtml = (inv, opts = {}) => T.renderInvoiceHtml(inv, { fontCss: fonts(), logoHtml: logo(), ...opts });
