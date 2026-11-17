#!/usr/bin/env node
// CLI: invoice <command> [options]
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadInvoices, loadSettings, nextNumber, padNumber, outputDir } from './src/core.js';
import { renderInvoiceHtml } from './src/template.js';
import { issueAndSave, pdfForNumber, previewBulk } from './src/service.js';
import { closeBrowser } from './src/pdf.js';

const HELP = `
Invoice generator — Bulgarian-law compliant invoices in EUR

Usage:
  invoice new      -m 2026-11 -a 4249.44 [-l en] [--preview] [--yes] [--open]
  invoice bulk     2026-01=4000 2026-02=4100.50 ...   [-l en] [--preview] [--yes]
  invoice bulk     -f rows.txt        (lines: "YYYY-MM amount")
  invoice list
  invoice pdf      <number> [-l en]   re-export an issued invoice to the output folder
  invoice next     show next invoice number
  invoice serve    start the web UI (same as npm start)

Options:
  -m, --month      YYYY-MM  (default: current month)
  -a, --amount     amount in EUR
  -l, --lang       bg | en  (default from settings)
  -f, --file       file with bulk rows
      --preview    don't issue – write a draft HTML preview and open it
  -y, --yes        skip confirmation
      --open       open the PDF(s) after generation
`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    month: { type: 'string', short: 'm' }, amount: { type: 'string', short: 'a' }, lang: { type: 'string', short: 'l' },
    file: { type: 'string', short: 'f' }, preview: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' },
    open: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m` };
const eur = (cents) => '€' + (cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 });
const openFile = (f) => exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} "${f}"`);

async function confirm(q) {
  if (o.yes) return true;
  if (!process.stdin.isTTY) { console.error(c.r('Not a TTY – pass --yes to confirm.')); return false; }
  process.stdout.write(`${q} ${c.dim('[y/N]')} `);
  return new Promise((res) => process.stdin.once('data', (d) => { process.stdin.pause(); res(/^y/i.test(String(d).trim())); }));
}

function parseRows() {
  let lines = positionals.slice(1);
  if (o.file) lines = fs.readFileSync(o.file, 'utf8').split('\n');
  return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const m = l.match(/^(\d{4})-(\d{1,2})[\s=,;:\t]+(.+)$/);
    if (!m) throw new Error(`Bad row "${l}" – expected YYYY-MM=amount`);
    return { month: `${m[1]}-${m[2].padStart(2, '0')}`, amount: m[3].trim() };
  });
}

async function run(rows) {
  const lang = o.lang || loadSettings().defaultLang;
  const { invoices, warnings } = previewBulk(rows, lang);
  console.log();
  for (const inv of invoices)
    console.log(`  ${c.b('№ ' + inv.numberStr)}  ${inv.month}  ${c.dim(inv.issueDate + ' → ' + inv.dueDate)}  ${c.g(eur(inv.amountCents))}  ${c.dim(lang.toUpperCase())}`);
  warnings.forEach((w) => console.log(c.y('  ⚠ ' + w)));
  console.log();

  if (o.preview) {
    const dir = path.join(outputDir(), '.preview');
    fs.mkdirSync(dir, { recursive: true });
    for (const inv of invoices) {
      const f = path.join(dir, `preview-${inv.numberStr}.html`);
      fs.writeFileSync(f, renderInvoiceHtml(inv, { draft: true }));
      console.log(c.dim('  preview → ') + f);
      openFile(f);
    }
    return;
  }
  if (!(await confirm(`Issue ${invoices.length} invoice(s)?`))) return console.log('Cancelled.');
  const { results } = await issueAndSave(rows, lang);
  for (const r of results) { console.log(c.g('  ✓ ') + r.file); if (o.open) openFile(r.file); }
}

async function main() {
  const cmd = positionals[0];
  if (o.help || !cmd) return console.log(HELP);
  switch (cmd) {
    case 'new': {
      if (!o.amount) throw new Error('--amount is required');
      return run([{ month: o.month || new Date().toISOString().slice(0, 7), amount: o.amount }]);
    }
    case 'bulk': return run(parseRows());
    case 'list': {
      const list = loadInvoices().sort((a, b) => a.number - b.number);
      if (!list.length) return console.log('No invoices yet.');
      for (const i of list) console.log(`  № ${padNumber(i.number)}  ${i.month}  ${i.issueDate}  ${eur(i.amountCents).padStart(12)}  ${i.lang.toUpperCase()}`);
      return;
    }
    case 'next': return console.log(padNumber(nextNumber()));
    case 'pdf': {
      const { pdf, name } = await pdfForNumber(positionals[1], o.lang);
      const f = path.join(outputDir(), name);
      fs.writeFileSync(f, pdf);
      console.log(c.g('  ✓ ') + f);
      if (o.open) openFile(f);
      return;
    }
    case 'serve': return import('./server.js');
    default: console.log(HELP);
  }
}

main()
  .catch((e) => { console.error(c.r('Error: ') + e.message); process.exitCode = 1; })
  .finally(() => { if (positionals[0] !== 'serve') closeBrowser(); });
