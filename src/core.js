// Settings, storage, numbering and invoice model building.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_THEMES } from './themes.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');

export const BGN_PER_EUR = 1.95583;
// Bulgaria joined the euro on 2026-01-01; dual EUR/BGN display was mandatory until 2026-08-08.
const DUAL_DISPLAY_UNTIL = '2026-08-08';

export const DEFAULT_SETTINGS = {
  // Placeholder data – fill in your real details in the Settings tab (stored in data/settings.json, git-ignored).
  supplier: {
    name: { bg: 'Примерна фирма ЕООД', en: 'Example Company EOOD' },
    address: { bg: 'ул. Примерна №1', en: '1 Example St' },
    city: { bg: 'София', en: 'Sofia' },
    country: { bg: 'България', en: 'Bulgaria' },
    mol: { bg: 'Иван Иванов', en: 'Ivan Ivanov' },
    eik: '000000000',
    vatNumber: '', // fill (e.g. BG000000000) only if VAT-registered
    phone: '+359 000 000 000',
    email: 'billing@example.com',
    bank: { name: '', iban: '', bic: '' },
  },
  client: {
    name: { bg: 'Example Client LLC', en: 'Example Client LLC' },
    address: { bg: '100 Main Street', en: '100 Main Street' },
    city: { bg: 'Springfield, IL 62701', en: 'Springfield, IL 62701' },
    country: { bg: 'САЩ', en: 'USA' },
    mol: { bg: 'John Doe', en: 'John Doe' },
    taxId: '00-0000000',
    vatNumber: '',
    phone: '+1 000 000 0000',
    email: 'accounts@example.com',
  },
  item: {
    description: {
      bg: 'Услуги по разработка на софтуер за {month} {year} г.',
      en: 'Software development services for {month} {year}',
    },
    unit: { bg: 'услуга', en: 'service' },
  },
  vat: {
    rate: 0,
    // Not VAT-registered → чл. 113, ал. 9 ЗДДС. If registered, a B2B service to a US client
    // is outside the scope of BG VAT: "чл. 21, ал. 2 ЗДДС" / "Art. 21(2) VAT Act – reverse charge".
    exemptReason: {
      bg: 'чл. 113, ал. 9 от ЗДДС',
      en: 'Art. 113(9) of the Bulgarian VAT Act (supplier not registered for VAT)',
    },
  },
  paymentMethod: { bg: 'Банков превод', en: 'Bank transfer' },
  compiledBy: { bg: 'Иван Иванов', en: 'Ivan Ivanov' },
  footerNote: { bg: 'Благодарим за доверието!', en: 'Thank you for your business!' },
  startNumber: 1,
  defaultLang: 'bg',
  defaultAmount: 1000,
  dualCurrency: 'auto', // auto | always | never  (BGN equivalent next to EUR)
  outputDir: 'output',
  colors: {
    accent: '#0f766e',     // top band, labels, badge, words bar
    background: '#ffffff', // page
    text: '#0f172a',       // main text
    muted: '#64748b',      // secondary labels
    line: '#0f172a',       // borders, dividers & "Сума за плащане" box
    panel: '#f8fafc',      // party boxes & "in words" box
  },
  themes: PRESET_THEMES, // [{ name, colors }]
};

const MONTHS = {
  bg: ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, over) {
  if (!isObj(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  return out;
}

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

export function loadSettings() {
  const stored = readJson(SETTINGS_FILE, null);
  if (stored?.accent) { // migrate old single accent setting
    stored.colors = { accent: stored.accent, ...stored.colors };
    delete stored.accent;
  }
  if (stored?.colors) { delete stored.colors.totalBg; delete stored.colors.totalText; }
  if (!stored) writeJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  return deepMerge(DEFAULT_SETTINGS, stored);
}
export function saveSettings(s) {
  const merged = deepMerge(DEFAULT_SETTINGS, s);
  writeJson(SETTINGS_FILE, merged);
  return merged;
}

export const loadInvoices = () => readJson(INVOICES_FILE, []);
const saveInvoices = (list) => writeJson(INVOICES_FILE, list);

export function nextNumber(settings = loadSettings(), invoices = loadInvoices()) {
  const maxIssued = invoices.reduce((m, i) => Math.max(m, i.number), 0);
  return Math.max(Number(settings.startNumber) || 1, maxIssued + 1);
}

export const padNumber = (n) => String(n).padStart(10, '0');

// ---------- dates & money ----------
const pad2 = (n) => String(n).padStart(2, '0');
export function monthDates(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error(`Invalid month "${month}" (expected YYYY-MM)`);
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error(`Invalid month "${month}"`);
  const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  return { year: y, month: mo, issueDate: `${y}-${pad2(mo)}-01`, dueDate: `${ny}-${pad2(nm)}-01` };
}

export function toCents(amount) {
  const n = typeof amount === 'string' ? Number(amount.replace(/\s/g, '').replace(',', '.')) : Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid amount "${amount}"`);
  return Math.round(n * 100);
}

export function fmtDate(iso, lang) {
  const [y, m, d] = iso.split('-');
  return lang === 'en' ? `${d}.${m}.${y}` : `${d}.${m}.${y} г.`;
}

export function fmtMoney(cents, lang, currency = 'EUR') {
  const v = (cents / 100).toLocaleString(lang === 'en' ? 'en-GB' : 'bg-BG', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true,
  }).replace(/ | /g, ' ');
  if (currency === 'BGN') return `${v} ${lang === 'en' ? 'BGN' : 'лв.'}`;
  return lang === 'en' ? `€${v}` : `${v} €`;
}

export function showDual(settings, issueDate) {
  if (settings.dualCurrency === 'always') return true;
  if (settings.dualCurrency === 'never') return false;
  return issueDate <= DUAL_DISPLAY_UNTIL;
}

// ---------- model ----------
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

/** Build an invoice record (pure – does not persist). */
export function buildInvoice({ month, amount, lang, number }, settings = loadSettings(), invoices = loadInvoices()) {
  lang = lang === 'en' ? 'en' : 'bg';
  const d = monthDates(month);
  const amountCents = toCents(amount);
  const num = number ?? nextNumber(settings, invoices);
  const descVars = { month: MONTHS[lang][d.month - 1], year: d.year };
  return {
    number: num,
    numberStr: padNumber(num),
    month,
    issueDate: d.issueDate,
    taxEventDate: d.issueDate,
    dueDate: d.dueDate,
    lang,
    amountCents,
    // snapshot of parties etc. so re-rendering later is byte-for-byte the same document
    snapshot: {
      supplier: settings.supplier,
      client: settings.client,
      vat: settings.vat,
      paymentMethod: settings.paymentMethod,
      compiledBy: settings.compiledBy,
      footerNote: settings.footerNote,
      colors: settings.colors,
      dualCurrency: settings.dualCurrency,
      itemDescription: {
        bg: fill(settings.item.description.bg, { month: MONTHS.bg[d.month - 1], year: d.year }),
        en: fill(settings.item.description.en, { month: MONTHS.en[d.month - 1], year: d.year }),
      },
      itemUnit: settings.item.unit,
    },
    descVars,
  };
}

/** Validation warnings (non-blocking) for a set of new invoices. */
export function checkWarnings(newOnes, invoices = loadInvoices()) {
  const warnings = [];
  const last = invoices.reduce((a, i) => (!a || i.number > a.number ? i : a), null);
  const months = new Set(invoices.map((i) => i.month));
  const seen = new Set();
  for (const inv of newOnes) {
    if (months.has(inv.month)) warnings.push(`${inv.month}: an invoice for this month already exists.`);
    if (seen.has(inv.month)) warnings.push(`${inv.month}: listed more than once.`);
    seen.add(inv.month);
    if (last && inv.issueDate < last.issueDate)
      warnings.push(`${inv.month}: issue date ${inv.issueDate} is before last issued invoice №${padNumber(last.number)} (${last.issueDate}). Bulgarian law expects numbers to follow date order.`);
  }
  return warnings;
}

/** Assign sequential numbers (sorted by month) and persist. Returns issued records. */
export function issueInvoices(rows, lang) {
  const settings = loadSettings();
  const invoices = loadInvoices();
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  let n = nextNumber(settings, invoices);
  const issued = sorted.map((r) => buildInvoice({ ...r, lang: r.lang || lang, number: n++ }, settings, invoices));
  const warnings = checkWarnings(issued, invoices);
  const now = new Date().toISOString();
  for (const inv of issued) inv.createdAt = now;
  saveInvoices([...invoices, ...issued]);
  return { issued, warnings };
}

export function getInvoice(number) {
  return loadInvoices().find((i) => i.number === Number(number));
}

/** Only the most recent invoice can be removed (keeps numbering gap-free). */
export function deleteLastInvoice(number) {
  const list = loadInvoices();
  const max = list.reduce((m, i) => Math.max(m, i.number), 0);
  if (Number(number) !== max) throw new Error('Only the latest invoice can be deleted (numbering must stay continuous).');
  saveInvoices(list.filter((i) => i.number !== max));
}

export function outputDir(settings = loadSettings()) {
  const dir = path.isAbsolute(settings.outputDir) ? settings.outputDir : path.join(ROOT, settings.outputDir || 'output');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const fileName = (inv, lang = inv.lang) =>
  `${lang === 'en' ? 'Invoice' : 'Фактура'} ${padNumber(inv.number)}${lang !== inv.lang ? ` (${lang.toUpperCase()})` : ''}.pdf`;
