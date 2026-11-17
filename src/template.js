// Renders a self-contained A4 invoice HTML (fonts inlined) – used for both preview and PDF.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DEFAULT_SETTINGS, BGN_PER_EUR, fmtDate, fmtMoney, showDual } from './core.js';
import { amountInWords } from './words.js';

const L = {
  bg: {
    invoice: 'Фактура', original: 'Оригинал', paid: 'Платена', no: '№', issueDate: 'Дата на издаване', taxEvent: 'Дата на данъчно събитие',
    dueDate: 'Срок за плащане', place: 'Място на издаване', supplier: 'Доставчик', recipient: 'Получател',
    eik: 'ЕИК', vatNo: 'ДДС №', taxId: 'Идент. №', mol: 'МОЛ', phone: 'Тел.', email: 'Имейл',
    nr: '№', description: 'Описание', unit: 'Мярка', qty: 'К-во', unitPrice: 'Ед. цена', amount: 'Стойност',
    taxBase: 'Данъчна основа', vat: 'ДДС', total: 'Сума за плащане', words: 'Словом',
    vatReason: 'Основание за неначисляване на ДДС', payment: 'Начин на плащане', bank: 'Банка', iban: 'IBAN', bic: 'BIC',
    compiledBy: 'Съставил', received: 'Получил', bgnEq: 'Равностойност в лева по фиксирания курс 1 € = 1,95583 лв.',
    sigNote: 'Подписът и печатът не са задължителни реквизити на фактурата съгласно чл. 7, ал. 1 от Закона за счетоводството.',
    currency: 'Валута: евро (EUR)',
  },
  en: {
    invoice: 'Invoice', original: 'Original', paid: 'Paid', no: 'No.', issueDate: 'Issue date', taxEvent: 'Tax event date',
    dueDate: 'Due date', place: 'Place of issue', supplier: 'Supplier', recipient: 'Bill to',
    eik: 'UIC (EIK)', vatNo: 'VAT No.', taxId: 'Tax ID', mol: 'Representative', phone: 'Phone', email: 'Email',
    nr: '#', description: 'Description', unit: 'Unit', qty: 'Qty', unitPrice: 'Unit price', amount: 'Amount',
    taxBase: 'Tax base', vat: 'VAT', total: 'Amount due', words: 'In words',
    vatReason: 'VAT exemption basis', payment: 'Payment method', bank: 'Bank', iban: 'IBAN', bic: 'BIC',
    compiledBy: 'Issued by', received: 'Received by', bgnEq: 'BGN equivalent at the fixed rate €1 = 1.95583 BGN',
    sigNote: 'Signature and stamp are not mandatory invoice requisites under Art. 7(1) of the Bulgarian Accountancy Act.',
    currency: 'Currency: euro (EUR)',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
    const f = path.join(ROOT, 'data', `logo.${ext}`);
    if (fs.existsSync(f)) {
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return `<img class="logo" src="data:${mime};base64,${fs.readFileSync(f).toString('base64')}" alt="">`;
    }
  }
  return '';
}

function party(p, lang, t, kind) {
  const row = (label, val) => (val ? `<div class="kv"><span>${esc(label)}</span><b>${esc(val)}</b></div>` : '');
  const idLine = kind === 'supplier' ? row(t.eik, p.eik) : row(t.taxId, p.taxId);
  return `
    <div class="party">
      <div class="party-label">${esc(kind === 'supplier' ? t.supplier : t.recipient)}</div>
      <div class="party-name">${esc(p.name[lang])}</div>
      <div class="addr">${esc(p.address[lang])}<br>${esc(p.city[lang])}, ${esc(p.country[lang])}</div>
      <div class="kvs">
        ${idLine}
        ${row(t.vatNo, p.vatNumber)}
        ${row(t.mol, p.mol?.[lang])}
        ${row(t.phone, p.phone)}
        ${row(t.email, p.email)}
      </div>
    </div>`;
}

/**
 * @param inv invoice record from buildInvoice()/store
 * @param opts.lang override language (re-render stored invoice in other language)
 * @param opts.draft show DRAFT watermark
 */
export function renderInvoiceHtml(inv, { lang = inv.lang, draft = false } = {}) {
  const t = L[lang];
  const s = inv.snapshot;
  const col = { ...DEFAULT_SETTINGS.colors, ...(s.accent ? { accent: s.accent } : {}), ...s.colors };
  const amount = inv.amountCents;
  const vatCents = Math.round((amount * (s.vat.rate || 0)) / 100);
  const total = amount + vatCents;
  const dual = showDual({ dualCurrency: s.dualCurrency }, inv.issueDate);
  const bgn = (c) => (dual ? `<div class="bgn">${fmtMoney(Math.round(c * BGN_PER_EUR), lang, 'BGN')}</div>` : '');
  const m = (c) => fmtMoney(c, lang);
  const bank = s.supplier.bank || {};
  const hasBank = bank.iban || bank.name;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(t.invoice)} ${inv.numberStr}</title>
<style>
${fonts()}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --accent: ${esc(col.accent)}; --ink: ${esc(col.text)}; --muted: ${esc(col.muted)}; --line: ${esc(col.line)};
  --soft: ${esc(col.panel)}; --bg: ${esc(col.background)}; }
html, body { background: var(--bg); }
body { font-family: 'InterInv', system-ui, sans-serif; color: var(--ink); font-size: 9.6pt; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; font-feature-settings: 'tnum' 1, 'cv11' 1; }
.page { width: 210mm; min-height: 297mm; padding: 16mm 16mm 14mm; position: relative; display: flex; flex-direction: column; overflow: hidden; }
.band { position: absolute; inset: 0 0 auto 0; height: 4mm; background: var(--accent); }
.top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; margin-top: 2mm; }
.title { font-size: 26pt; font-weight: 750; letter-spacing: -0.02em; text-transform: uppercase; line-height: 1; }
.num { margin-top: 3mm; font-size: 11pt; color: var(--muted); }
.num b { color: var(--ink); font-weight: 650; letter-spacing: 0.04em; }
.pill { display: inline-block; margin-left: 3mm; padding: 0.8mm 2.6mm; border-radius: 99px; font-size: 7.5pt; font-weight: 650;
  letter-spacing: .08em; text-transform: uppercase; color: var(--accent); border: 0.3mm solid var(--accent); vertical-align: 3pt; }
.pill.paid { margin-left: 1.5mm; background: var(--accent); color: var(--bg); }
.logo { max-height: 18mm; max-width: 50mm; display: block; margin-left: auto; margin-bottom: 3mm; }
.dates { text-align: right; }
.dates .kv { justify-content: flex-end; gap: 4mm; }
.kv { display: flex; gap: 2mm; }
.kv span { color: var(--muted); }
.kv b { font-weight: 550; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 10mm; }
.party { border: 0.3mm solid var(--line); border-radius: 3mm; padding: 5mm; background: var(--soft); }
.party-label { font-size: 7.5pt; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
.party-name { font-size: 12.5pt; font-weight: 700; margin-top: 1.5mm; }
.addr { margin-top: 1mm; color: var(--ink); opacity: .85; }
.kvs { margin-top: 3mm; display: grid; gap: .6mm; }
.kvs .kv span { min-width: 22mm; }
table { width: 100%; border-collapse: collapse; margin-top: 10mm; }
th { text-align: left; font-size: 7.5pt; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--muted);
  padding: 0 2.5mm 2.5mm; border-bottom: 0.4mm solid var(--ink); }
td { padding: 3.5mm 2.5mm; border-bottom: 0.3mm solid var(--line); vertical-align: top; }
.r { text-align: right; white-space: nowrap; }
td.desc { font-weight: 550; }
.bgn { color: var(--muted); font-size: 8pt; font-weight: 400; }
.summary { display: grid; grid-template-columns: 1fr 78mm; gap: 8mm; margin-top: 7mm; align-items: start; }
.notes { display: grid; gap: 3mm; font-size: 8.8pt; }
.note-label { font-size: 7.5pt; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: .6mm; }
.totals .kv { justify-content: space-between; padding: 1.6mm 0; }
.totals .kv b { text-align: right; }
.grand { margin-top: 2mm; padding: 4mm 4.5mm; border-radius: 3mm; background: var(--line); color: var(--bg); display: flex; justify-content: space-between; align-items: baseline; }
.grand span { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; opacity: .75; }
.grand b { font-size: 16pt; font-weight: 700; letter-spacing: -0.01em; }
.grand .bgn { color: var(--bg); opacity: .7; text-align: right; }
.words { margin-top: 6mm; padding: 3.5mm 4.5mm; border-left: 1mm solid var(--accent); background: var(--soft); border-radius: 0 2mm 2mm 0; }
.spacer { flex: 1; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 12mm; }
.sign div { border-top: 0.3mm solid var(--line); padding-top: 2mm; color: var(--muted); font-size: 8.5pt; }
.sign b { color: var(--ink); font-weight: 550; }
.foot { margin-top: 8mm; display: flex; justify-content: space-between; align-items: end; gap: 8mm; color: var(--muted); font-size: 7.5pt; }
.thanks { font-size: 10pt; color: var(--ink); font-weight: 550; }
.draft { position: absolute; top: 120mm; left: 0; right: 0; text-align: center; font-size: 90pt; font-weight: 800; color: var(--ink); opacity: .045;
  transform: rotate(-24deg); letter-spacing: .1em; pointer-events: none; }
</style>
</head>
<body>
<div class="page">
  <div class="band"></div>
  ${draft ? `<div class="draft">${lang === 'en' ? 'PREVIEW' : 'ПРЕГЛЕД'}</div>` : ''}
  <div class="top">
    <div>
      <div class="title">${esc(t.invoice)}<span class="pill">${esc(t.original)}</span><span class="pill paid">✓ ${esc(t.paid)}</span></div>
      <div class="num">${esc(t.no)} <b>${inv.numberStr}</b></div>
    </div>
    <div class="dates">
      ${logo()}
      <div class="kv"><span>${esc(t.issueDate)}</span><b>${fmtDate(inv.issueDate, lang)}</b></div>
      <div class="kv"><span>${esc(t.dueDate)}</span><b>${fmtDate(inv.dueDate, lang)}</b></div>
    </div>
  </div>

  <div class="parties">
    ${party(s.supplier, lang, t, 'supplier')}
    ${party(s.client, lang, t, 'client')}
  </div>

  <table>
    <thead><tr>
      <th style="width:8mm">${esc(t.nr)}</th><th>${esc(t.description)}</th>
      <th class="r">${esc(t.qty)}</th><th class="r">${esc(t.unitPrice)}</th><th class="r">${esc(t.vat)}</th><th class="r">${esc(t.amount)}</th>
    </tr></thead>
    <tbody><tr>
      <td>1</td>
      <td class="desc">${esc(s.itemDescription[lang])}</td>
      <td class="r">1</td>
      <td class="r">${m(amount)}${bgn(amount)}</td>
      <td class="r">${s.vat.rate || 0}%</td>
      <td class="r"><b>${m(amount)}</b>${bgn(amount)}</td>
    </tr></tbody>
  </table>

  <div class="summary">
    <div class="notes">
      ${!s.vat.rate ? `<div><div class="note-label">${esc(t.vatReason)}</div>${esc(s.vat.exemptReason[lang])}</div>` : ''}
      <div><div class="note-label">${esc(t.payment)}</div>${esc(s.paymentMethod[lang])}${hasBank ? `<br>${bank.name ? `${esc(t.bank)}: ${esc(bank.name)}<br>` : ''}${bank.iban ? `${t.iban}: <b>${esc(bank.iban)}</b>` : ''}${bank.bic ? ` &nbsp;·&nbsp; ${t.bic}: ${esc(bank.bic)}` : ''}` : ''}</div>
      ${dual ? `<div class="bgn">${esc(t.bgnEq)}</div>` : ''}
    </div>
    <div class="totals">
      <div class="kv"><span>${esc(t.taxBase)}</span><b>${m(amount)}${bgn(amount)}</b></div>
      <div class="kv"><span>${esc(t.vat)} ${s.vat.rate || 0}%</span><b>${m(vatCents)}${bgn(vatCents)}</b></div>
      <div class="grand"><span>${esc(t.total)}</span><div><b>${m(total)}</b>${bgn(total)}</div></div>
    </div>
  </div>

  <div class="words"><div class="note-label">${esc(t.words)}</div>${esc(amountInWords(total, lang))}</div>

  <div class="spacer"></div>

  <div class="sign">
    <div style="border:0"></div>
    <div>${esc(t.compiledBy)}: <b>${esc(s.compiledBy[lang])}</b></div>
  </div>
  <div class="foot">
    <div class="thanks">${esc(s.footerNote[lang])}</div>
    <div style="max-width:95mm;text-align:right">${esc(t.sigNote)}</div>
  </div>
</div>
</body>
</html>`;
}
