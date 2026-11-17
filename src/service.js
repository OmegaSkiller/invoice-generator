// High-level operations shared by the web server and the CLI.
import fs from 'node:fs';
import path from 'node:path';
import { buildInvoice, checkWarnings, fileName, getInvoice, issueInvoices, loadInvoices, loadSettings, outputDir } from './core.js';
import { renderInvoiceHtml } from './template.js';
import { htmlToPdf } from './pdf.js';

export function previewHtml({ month, amount, lang }) {
  const inv = buildInvoice({ month, amount, lang });
  return { html: renderInvoiceHtml(inv, { draft: true }), invoice: inv, warnings: checkWarnings([inv]) };
}

/** Preview several rows as they would be numbered when issued. */
export function previewBulk(rows, lang) {
  const settings = loadSettings();
  const invoices = loadInvoices();
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  let n = Math.max(Number(settings.startNumber) || 1, invoices.reduce((m, i) => Math.max(m, i.number), 0) + 1);
  const built = sorted.map((r) => buildInvoice({ ...r, lang: r.lang || lang, number: n++ }, settings, invoices));
  return { invoices: built, warnings: checkWarnings(built, invoices) };
}

export async function invoicePdf(inv, lang = inv.lang) {
  return htmlToPdf(renderInvoiceHtml(inv, { lang }));
}

/** Issue → render → save into outputDir. Returns [{ invoice, file, pdf }]. */
export async function issueAndSave(rows, lang) {
  const { issued, warnings } = issueInvoices(rows, lang);
  const dir = outputDir();
  const results = [];
  for (const inv of issued) {
    const pdf = await invoicePdf(inv);
    const file = path.join(dir, fileName(inv));
    fs.writeFileSync(file, pdf);
    results.push({ invoice: inv, file, pdf });
  }
  return { results, warnings };
}

export async function pdfForNumber(number, lang) {
  const inv = getInvoice(number);
  if (!inv) throw new Error(`Invoice ${number} not found`);
  const l = lang || inv.lang;
  return { invoice: inv, pdf: await invoicePdf(inv, l), name: fileName(inv, l) };
}
