// Browser-only backend used on GitHub Pages: same routes as server.js, stored in localStorage.
import {
  DEFAULT_SETTINGS, deepMerge, mergeSettings, nextNumber, buildInvoice, checkWarnings, planInvoices, assertDeletable, padNumber, fileName,
} from './shared/model.js';
import { renderInvoiceHtml as render, renderInvoicesHtml as renderMany } from './shared/template.js';

const KEY_S = 'invoice-generator:settings';
const KEY_I = 'invoice-generator:invoices';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch { throw new Error('Browser storage is full or blocked – export a backup and free some space.'); }
};

const fontUrl = (f) => new URL(`fonts/${f}`, document.baseURI).href;
const fontCss = () =>
  `@font-face{font-family:'InterInv';font-weight:100 900;font-display:block;src:url('${fontUrl('inter-latin-wght-normal.woff2')}') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212;}` +
  `@font-face{font-family:'InterInv';font-weight:100 900;font-display:block;src:url('${fontUrl('inter-cyrillic-wght-normal.woff2')}') format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;}`;

const opts = (o = {}) => ({ fontCss: fontCss(), ...o });
export const loadSettings = () => mergeSettings(read(KEY_S, null));
export const loadInvoices = () => read(KEY_I, []);
const getInvoice = (n) => loadInvoices().find((i) => i.number === Number(n));

export function renderHtml(number, lang) {
  const inv = getInvoice(number);
  if (!inv) throw new Error(`Invoice ${number} not found`);
  return render(inv, opts({ lang: lang || inv.lang }));
}
/** One printable document for several invoices. */
export function renderManyHtml(numbers, lang) {
  const list = numbers.map((n) => ({ inv: getInvoice(n), lang })).filter((x) => x.inv);
  const title = list.length === 1 ? fileName(list[0].inv, lang || list[0].inv.lang).replace(/\.pdf$/, '')
    : `Invoices ${padNumber(list[0].inv.number)}-${padNumber(list.at(-1).inv.number)}`;
  return { html: renderMany(list, opts({ title })), title };
}

function state() {
  const settings = loadSettings();
  const all = loadInvoices();
  const invoices = all.map(({ snapshot, descVars, ...rest }) => rest).sort((a, b) => b.number - a.number);
  return { settings, invoices, nextNumber: nextNumber(settings, all) };
}

export function exportBackup() {
  return { app: 'invoice-generator', version: 1, exportedAt: new Date().toISOString(), settings: loadSettings(), invoices: loadInvoices() };
}
export function importBackup(data) {
  if (!data || data.app !== 'invoice-generator' || !Array.isArray(data.invoices)) throw new Error('Not an invoice-generator backup file.');
  write(KEY_S, deepMerge(DEFAULT_SETTINGS, data.settings));
  write(KEY_I, data.invoices);
  return state();
}

/** Mirrors the HTTP API of server.js. */
export async function localApi(method, url, body = {}) {
  const u = new URL(url, location.href);
  const route = `${method} ${u.pathname.replace(/^.*\/api\//, 'api/')}`;
  const settings = loadSettings();
  const invoices = loadInvoices();
  let m;
  switch (route) {
    case 'GET api/state': return state();
    case 'PUT api/settings': write(KEY_S, deepMerge(DEFAULT_SETTINGS, body)); return state();
    case 'POST api/preview': {
      const inv = buildInvoice({ ...body, number: undefined }, settings, invoices);
      return { html: render(inv, opts({ draft: true })), number: inv.numberStr, issueDate: inv.issueDate, dueDate: inv.dueDate, warnings: checkWarnings([inv], invoices) };
    }
    case 'POST api/preview-bulk': {
      const { invoices: list, warnings } = planInvoices(body.rows, body.lang, settings, invoices);
      return { warnings, invoices: list.map((i) => ({ number: i.numberStr, month: i.month, issueDate: i.issueDate, dueDate: i.dueDate, amountCents: i.amountCents, html: render(i, opts({ draft: true })) })) };
    }
    case 'POST api/issue': {
      const { invoices: issued, warnings } = planInvoices(body.rows, body.lang, settings, invoices);
      const now = new Date().toISOString();
      issued.forEach((i) => (i.createdAt = now));
      write(KEY_I, [...invoices, ...issued]);
      return { warnings, issued: issued.map((i) => ({ number: i.number, name: fileName(i) })), ...state() };
    }
  }
  if (method === 'DELETE' && (m = route.match(/api\/invoices\/(\d+)$/))) {
    assertDeletable(m[1], invoices);
    write(KEY_I, invoices.filter((i) => i.number !== Number(m[1])));
    return state();
  }
  throw new Error(`Not available in the browser version: ${route}`);
}
