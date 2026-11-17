#!/usr/bin/env node
// Local web UI. Zero-framework node:http server bound to 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { ROOT, loadSettings, saveSettings, loadInvoices, nextNumber, deleteLastInvoice, getInvoice, fileName } from './src/core.js';
import { renderInvoiceHtml } from './src/template.js';
import { previewHtml, previewBulk, issueAndSave, pdfForNumber } from './src/service.js';
import { zip } from './src/zip.js';

const PORT = Number(process.env.PORT) || 4321;
const PUBLIC = path.join(ROOT, 'public');
const FONT_DIR = path.join(ROOT, 'node_modules/@fontsource-variable/inter/files');
const SHARED = path.join(ROOT, 'src/shared');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const attachment = (res, buf, name, type) => {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="invoice.${type.includes('zip') ? 'zip' : 'pdf'}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Length': buf.length,
  });
  res.end(buf);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
});
const state = () => {
  const settings = loadSettings();
  const invoices = loadInvoices().map(({ snapshot, descVars, ...rest }) => rest).sort((a, b) => b.number - a.number);
  return { settings, invoices, nextNumber: nextNumber(settings) };
};

const routes = {
  'GET /api/state': async () => state(),
  'PUT /api/settings': async (req) => { saveSettings(await readBody(req)); return state(); },
  'POST /api/preview': async (req) => {
    const { html, invoice, warnings } = previewHtml(await readBody(req));
    return { html, number: invoice.numberStr, issueDate: invoice.issueDate, dueDate: invoice.dueDate, warnings };
  },
  'POST /api/preview-bulk': async (req) => {
    const { rows, lang } = await readBody(req);
    const { invoices, warnings } = previewBulk(rows, lang);
    return {
      warnings,
      invoices: invoices.map((i) => ({ number: i.numberStr, month: i.month, issueDate: i.issueDate, dueDate: i.dueDate,
        amountCents: i.amountCents, html: renderInvoiceHtml(i, { draft: true }) })),
    };
  },
  'POST /api/issue': async (req) => {
    const { rows, lang } = await readBody(req);
    const { results, warnings } = await issueAndSave(rows, lang);
    return { warnings, issued: results.map((r) => ({ number: r.invoice.number, file: r.file, name: path.basename(r.file) })), ...state() };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return send(res, 200, await route(req, url));

    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/invoices\/(\d+)\/(pdf|html)$/))) {
      const lang = url.searchParams.get('lang') || undefined;
      if (m[2] === 'html') {
        const inv = getInvoice(m[1]);
        return inv ? send(res, 200, renderInvoiceHtml(inv, { lang }), MIME['.html']) : send(res, 404, { error: 'Not found' });
      }
      const { pdf, name } = await pdfForNumber(m[1], lang);
      return attachment(res, pdf, name, 'application/pdf');
    }
    if (req.method === 'DELETE' && (m = url.pathname.match(/^\/api\/invoices\/(\d+)$/))) {
      deleteLastInvoice(m[1]);
      return send(res, 200, state());
    }
    if (req.method === 'GET' && url.pathname === '/api/zip') {
      const numbers = (url.searchParams.get('numbers') || '').split(',').filter(Boolean);
      const files = [];
      for (const n of numbers) { const { pdf, name } = await pdfForNumber(n); files.push({ name, data: pdf }); }
      const inv = numbers.map(getInvoice).filter(Boolean);
      const label = inv.length ? `${inv[0].month}..${inv.at(-1).month}` : 'invoices';
      return attachment(res, zip(files), `Invoices ${label}.zip`, 'application/zip');
    }
    if (req.method === 'POST' && url.pathname === '/api/reveal') {
      const { number } = await readBody(req);
      const inv = getInvoice(number);
      const { outputDir } = await import('./src/core.js');
      const file = inv && path.join(outputDir(), fileName(inv));
      if (process.platform === 'darwin') exec(file && fs.existsSync(file) ? `open -R "${file}"` : `open "${outputDir()}"`);
      return send(res, 200, { ok: true });
    }

    // static
    if (req.method === 'GET') {
      let file;
      if (url.pathname.startsWith('/fonts/')) file = path.join(FONT_DIR, path.basename(url.pathname));
      else if (url.pathname.startsWith('/shared/')) file = path.join(SHARED, path.basename(url.pathname));
      else file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
      if (file.startsWith(PUBLIC) || file.startsWith(FONT_DIR) || file.startsWith(SHARED)) {
        if (fs.existsSync(file) && fs.statSync(file).isFile())
          return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Invoice generator → ${url}\n`);
  if (process.argv.includes('--open') && process.platform === 'darwin') exec(`open ${url}`);
});
