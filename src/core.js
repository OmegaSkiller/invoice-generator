// Node-side storage (data/*.json) on top of the shared pure model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from './shared/model.js';

export * from './shared/model.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.INVOICE_DATA_DIR ? path.resolve(process.env.INVOICE_DATA_DIR) : path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

export function loadSettings() {
  const stored = readJson(SETTINGS_FILE, null);
  if (!stored) writeJson(SETTINGS_FILE, M.DEFAULT_SETTINGS);
  return M.mergeSettings(stored);
}
export function saveSettings(s) {
  const merged = M.deepMerge(M.DEFAULT_SETTINGS, s);
  writeJson(SETTINGS_FILE, merged);
  return merged;
}

export const loadInvoices = () => readJson(INVOICES_FILE, []);
const saveInvoices = (list) => writeJson(INVOICES_FILE, list);

export const nextNumber = (settings = loadSettings(), invoices = loadInvoices()) => M.nextNumber(settings, invoices);
export const buildInvoice = (params, settings = loadSettings(), invoices = loadInvoices()) => M.buildInvoice(params, settings, invoices);
export const checkWarnings = (newOnes, invoices = loadInvoices()) => M.checkWarnings(newOnes, invoices);

/** Assign sequential numbers (sorted by month) and persist. */
export function issueInvoices(rows, lang) {
  const invoices = loadInvoices();
  const { invoices: issued, warnings } = M.planInvoices(rows, lang, loadSettings(), invoices);
  const now = new Date().toISOString();
  for (const inv of issued) inv.createdAt = now;
  saveInvoices([...invoices, ...issued]);
  return { issued, warnings };
}

export const getInvoice = (number) => loadInvoices().find((i) => i.number === Number(number));

export function deleteLastInvoice(number) {
  const list = loadInvoices();
  M.assertDeletable(number, list);
  saveInvoices(list.filter((i) => i.number !== Number(number)));
}

export function outputDir(settings = loadSettings()) {
  const dir = path.isAbsolute(settings.outputDir) ? settings.outputDir : path.join(ROOT, settings.outputDir || 'output');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
