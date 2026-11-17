const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const app = {
  state: null,
  lang: LS.get('lang', null),
  tab: LS.get('tab', 'single'),
  bulkRows: LS.get('bulkRows', []),
  bulkPreview: [],
  bulkSelected: 0,
};

// ---------- api ----------
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function download(url) {
  const a = document.createElement('a');
  a.href = url; a.download = '';
  document.body.append(a); a.click(); a.remove();
}

// ---------- helpers ----------
const thisMonth = () => new Date().toISOString().slice(0, 7);
const addMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo, 1)); return d.toISOString().slice(0, 7); };
const parseAmount = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const eur = (n) => '€' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dmy = (iso) => iso.split('-').reverse().join('.');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  const color = kind === 'error' ? 'border-rose-400/30 text-rose-200' : kind === 'warn' ? 'border-amber-400/30 text-amber-200' : 'border-teal-400/30 text-teal-100';
  el.className = `pointer-events-auto max-w-sm rounded-xl border bg-zinc-900/95 px-4 py-3 text-sm shadow-xl backdrop-blur fade-in ${color}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}

function warningsHtml(list) {
  if (!list?.length) return '';
  return `<div class="fade-in space-y-1 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-200">
    ${list.map((w) => `<p class="flex gap-2"><span>⚠</span><span>${esc(w)}</span></p>`).join('')}</div>`;
}

function confirmDialog(title, bodyHtml, okLabel = 'Issue') {
  const d = $('#confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-body').innerHTML = bodyHtml;
  $('#confirm-ok').textContent = okLabel;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

// ---------- preview ----------
const frame = $('#frame'), sheet = $('#sheet');
function fitSheet() {
  const stage = $('#stage');
  const avail = stage.clientWidth - 48;
  const scale = Math.min(1, avail / 794);
  sheet.style.transformOrigin = 'top left';
  sheet.style.transform = `scale(${scale})`;
  sheet.style.marginLeft = `${Math.max(0, (avail - 794 * scale) / 2)}px`;
  sheet.style.marginBottom = `${-(1123 * (1 - scale))}px`;
}
new ResizeObserver(fitSheet).observe($('#stage'));

let lastHtml = '';
function showPreview(html, label = '', actions = '') {
  $('#preview-label').textContent = label;
  $('#preview-actions').innerHTML = actions;
  $('#empty').classList.toggle('hidden', !!html);
  $('#empty').classList.toggle('grid', !html);
  sheet.style.opacity = html ? '1' : '0';
  if (!html || html === lastHtml) return;
  lastHtml = html;
  // swap without flashing: render into iframe then pulse the live dot
  frame.srcdoc = html;
  const dot = $('#live-dot');
  dot.classList.remove('animate-ping'); void dot.offsetWidth; dot.classList.add('animate-ping');
  setTimeout(() => dot.classList.remove('animate-ping'), 900);
}

// ---------- language ----------
function setLang(l) {
  app.lang = l; LS.set('lang', l);
  const ind = $('#lang-toggle .seg-indicator');
  ind.style.transform = l === 'en' ? 'translateX(100%)' : 'none';
  $$('#lang-toggle button').forEach((b) => {
    const on = b.dataset.lang === l;
    b.setAttribute('aria-checked', on);
    b.classList.toggle('text-zinc-950', on);
    b.classList.toggle('text-zinc-400', !on);
  });
  refresh();
}
$$('#lang-toggle button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ---------- tabs ----------
const TABS = ['single', 'bulk', 'history', 'settings'];
function setTab(t) {
  app.tab = t; LS.set('tab', t);
  $('#tab-indicator').style.transform = `translateX(${TABS.indexOf(t) * 100}%)`;
  $$('#tabs button').forEach((b) => b.classList.toggle('text-zinc-500', b.dataset.tab !== t));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== t));
  refresh();
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function refresh() {
  if (!app.state) return;
  if (app.tab === 'single') previewSingle();
  else if (app.tab === 'bulk') previewBulk();
  else if (app.tab === 'history') renderHistory();
  else if (app.tab === 'settings') previewSingle(true);
}

// ---------- single ----------
const sMonth = $('#s-month'), sAmount = $('#s-amount');
sMonth.value = LS.get('s-month', thisMonth());
sAmount.value = LS.get('s-amount', '');

const previewSingle = debounce(async (fromSettings = false) => {
  const month = sMonth.value, amount = parseAmount(sAmount.value) ?? (fromSettings ? app.state.settings.defaultAmount : null);
  if (!month || !amount) { showPreview('', ''); $('#s-warnings').innerHTML = ''; $('#s-issue').disabled = true; return; }
  try {
    const r = await api('POST', '/api/preview', { month, amount, lang: app.lang });
    if (app.tab !== 'single' && app.tab !== 'settings') return;
    $('#s-dates').textContent = `Issued ${dmy(r.issueDate)} · due ${dmy(r.dueDate)}`;
    $('#s-warnings').innerHTML = warningsHtml(r.warnings);
    $('#s-issue').disabled = false;
    showPreview(r.html, `№ ${r.number} · draft`);
  } catch (e) { toast(e.message, 'error'); }
}, 180);

sMonth.addEventListener('input', () => { LS.set('s-month', sMonth.value); previewSingle(); });
sAmount.addEventListener('input', () => { LS.set('s-amount', sAmount.value); previewSingle(); });

$('#s-issue').addEventListener('click', async () => {
  const amount = parseAmount(sAmount.value);
  if (!amount) return toast('Enter a valid amount', 'error');
  const ok = await confirmDialog(`Issue invoice № ${String(app.state.nextNumber).padStart(10, '0')}?`,
    `<p>${monthLabel(sMonth.value)} · <b class="text-zinc-100">${eur(amount)}</b> · ${app.lang.toUpperCase()}</p><p class="mt-2">The number is reserved permanently and the PDF is saved to the output folder.</p>`);
  if (!ok) return;
  await issue([{ month: sMonth.value, amount }]);
});

async function issue(rows) {
  const btns = [$('#s-issue'), $('#b-issue')];
  btns.forEach((b) => (b.disabled = true));
  try {
    const r = await api('POST', '/api/issue', { rows, lang: app.lang });
    applyState(r);
    r.warnings?.forEach((w) => toast(w, 'warn'));
    if (r.issued.length === 1) download(`/api/invoices/${r.issued[0].number}/pdf`);
    else download(`/api/zip?numbers=${r.issued.map((i) => i.number).join(',')}`);
    toast(`Issued ${r.issued.map((i) => i.name).join(', ')}`);
    return r;
  } catch (e) { toast(e.message, 'error'); }
  finally { btns.forEach((b) => (b.disabled = false)); refresh(); }
}

// ---------- bulk ----------
function saveRows() { LS.set('bulkRows', app.bulkRows); }
function renderRows() {
  const ul = $('#b-rows');
  ul.innerHTML = app.bulkRows.map((r, i) => `
    <li class="fade-in group flex items-center gap-2 rounded-xl border p-1.5 pl-2 transition ${i === app.bulkSelected ? 'border-teal-400/40 bg-teal-400/[0.05]' : 'border-white/[0.06] hover:border-white/15'}" data-i="${i}">
      <span class="w-8 shrink-0 text-center font-mono text-[11px] text-zinc-500">${app.bulkPreview[i] ? '№' + app.bulkPreview[i].number.replace(/^0+/, '') : ''}</span>
      <input type="month" value="${esc(r.month)}" data-k="month" class="field !py-2 !px-2.5 flex-1 min-w-0">
      <div class="relative w-28 shrink-0"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">€</span>
        <input value="${esc(r.amount)}" data-k="amount" inputmode="decimal" placeholder="0.00" class="field !py-2 !pl-7 text-right"></div>
      <button class="icon-btn opacity-50 group-hover:opacity-100" data-remove title="Remove">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </li>`).join('') || `<li class="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">No rows yet.</li>`;
  const valid = app.bulkRows.filter((r) => r.month && parseAmount(r.amount));
  $('#b-count').textContent = valid.length;
  $('#b-total').textContent = eur(valid.reduce((s, r) => s + parseAmount(r.amount), 0));
  $('#b-issue').disabled = !valid.length || valid.length !== app.bulkRows.length;
}

$('#b-rows').addEventListener('input', (e) => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  app.bulkRows[li.dataset.i][e.target.dataset.k] = e.target.value;
  saveRows(); previewBulk(true);
});
$('#b-rows').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const i = Number(li.dataset.i);
  if (e.target.closest('[data-remove]')) {
    app.bulkRows.splice(i, 1);
    app.bulkSelected = Math.min(app.bulkSelected, app.bulkRows.length - 1);
    saveRows(); renderRows(); previewBulk();
    return;
  }
  if (app.bulkSelected !== i) { app.bulkSelected = i; renderRows(); showBulkSelected(); }
});
$('#b-add').addEventListener('click', () => {
  const last = app.bulkRows.at(-1);
  app.bulkRows.push({ month: last?.month ? addMonth(last.month) : thisMonth(), amount: last?.amount ?? '' });
  app.bulkSelected = app.bulkRows.length - 1;
  saveRows(); renderRows(); previewBulk();
  $$('#b-rows input[data-k="amount"]').at(-1)?.focus();
});
$('#b-paste-toggle').addEventListener('click', () => $('#b-paste').classList.toggle('hidden'));
$('#b-paste-apply').addEventListener('click', () => {
  const rows = $('#b-paste-text').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{4})[-./](\d{1,2})[\s,;:\t]+(.+)$/);
    return m ? { month: `${m[1]}-${m[2].padStart(2, '0')}`, amount: m[3].trim() } : null;
  });
  if (rows.some((r) => !r)) return toast('Use one "YYYY-MM amount" per line', 'error');
  app.bulkRows = rows; app.bulkSelected = 0;
  $('#b-paste').classList.add('hidden');
  saveRows(); renderRows(); previewBulk();
});

function showBulkSelected() {
  if (app.tab !== 'bulk') return;
  const p = app.bulkPreview[app.bulkSelected];
  showPreview(p?.html || '', p ? `№ ${p.number} · ${monthLabel(p.month)} · draft` : '');
}

const previewBulk = debounce(async (keepFocus = false) => {
  if (!keepFocus) renderRows();
  const valid = app.bulkRows.every((r) => r.month && parseAmount(r.amount));
  if (!app.bulkRows.length || !valid) {
    $('#b-warnings').innerHTML = ''; app.bulkPreview = [];
    if (keepFocus) renderSummaryOnly();
    showBulkSelected(); return;
  }
  try {
    const r = await api('POST', '/api/preview-bulk', { rows: app.bulkRows.map((x) => ({ month: x.month, amount: parseAmount(x.amount) })), lang: app.lang });
    // server sorts by month; map previews back to row order
    app.bulkPreview = app.bulkRows.map((row) => r.invoices.find((p) => p.month === row.month && p.amountCents === Math.round(parseAmount(row.amount) * 100)));
    $('#b-warnings').innerHTML = warningsHtml(r.warnings);
    if (keepFocus) renderSummaryOnly(); else renderRows();
    showBulkSelected();
  } catch (e) { toast(e.message, 'error'); }
}, 200);

function renderSummaryOnly() {
  // update numbers + totals without re-rendering inputs (keeps caret position)
  $$('#b-rows li[data-i]').forEach((li) => {
    const p = app.bulkPreview[li.dataset.i];
    li.firstElementChild.textContent = p ? '№' + p.number.replace(/^0+/, '') : '';
  });
  const valid = app.bulkRows.filter((r) => r.month && parseAmount(r.amount));
  $('#b-count').textContent = valid.length;
  $('#b-total').textContent = eur(valid.reduce((s, r) => s + parseAmount(r.amount), 0));
  $('#b-issue').disabled = !valid.length || valid.length !== app.bulkRows.length;
}

$('#b-issue').addEventListener('click', async () => {
  const rows = app.bulkRows.map((r) => ({ month: r.month, amount: parseAmount(r.amount) }));
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const ok = await confirmDialog(`Issue ${rows.length} invoices?`,
    `<ul class="space-y-1">${sorted.map((r, i) => `<li class="flex justify-between"><span>№ ${app.state.nextNumber + i} · ${monthLabel(r.month)}</span><b class="text-zinc-100">${eur(r.amount)}</b></li>`).join('')}</ul>
     <p class="mt-3">Numbers are reserved permanently; PDFs are saved and downloaded as a ZIP.</p>`, `Issue ${rows.length}`);
  if (!ok) return;
  const r = await issue(rows);
  if (r) { app.bulkRows = []; app.bulkPreview = []; saveRows(); renderRows(); }
});

// ---------- history ----------
let historySelected = null;
function renderHistory() {
  const list = app.state.invoices;
  const maxNum = list[0]?.number;
  $('#h-list').innerHTML = list.length ? list.map((inv) => `
    <li class="fade-in group cursor-pointer rounded-xl border p-3 transition ${historySelected === inv.number ? 'border-teal-400/40 bg-teal-400/[0.05]' : 'border-white/[0.06] hover:border-white/15'}" data-n="${inv.number}">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="font-mono text-xs text-zinc-500">№ ${String(inv.number).padStart(10, '0')}</div>
          <div class="truncate text-sm font-medium">${monthLabel(inv.month)}</div>
        </div>
        <div class="text-right">
          <div class="text-sm font-semibold">${eur(inv.amountCents / 100)}</div>
          <div class="text-[11px] text-zinc-500">${dmy(inv.issueDate)} · ${inv.lang.toUpperCase()}</div>
        </div>
      </div>
      <div class="mt-2 flex gap-1 opacity-60 transition group-hover:opacity-100">
        <button class="btn-ghost !px-2.5 !py-1 text-xs" data-pdf="bg">PDF BG</button>
        <button class="btn-ghost !px-2.5 !py-1 text-xs" data-pdf="en">PDF EN</button>
        <button class="btn-ghost !px-2.5 !py-1 text-xs" data-reveal>Show in Finder</button>
        ${inv.number === maxNum ? `<button class="btn-ghost ml-auto !px-2.5 !py-1 text-xs !text-rose-300 hover:!border-rose-400/30" data-del>Delete</button>` : ''}
      </div>
    </li>`).join('') : `<li class="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No invoices issued yet.</li>`;
  if (historySelected == null && list[0]) historySelected = list[0].number;
  showHistoryPreview();
}
async function showHistoryPreview() {
  if (historySelected == null) return showPreview('', '');
  const lang = app.lang;
  const html = await fetch(`/api/invoices/${historySelected}/html?lang=${lang}`).then((r) => r.ok ? r.text() : '');
  if (app.tab !== 'history') return;
  showPreview(html, `№ ${String(historySelected).padStart(10, '0')} · issued`,
    `<button class="btn-ghost !px-3 !py-1.5 text-xs" onclick="location.href='/api/invoices/${historySelected}/pdf?lang=${lang}'">Download ${lang.toUpperCase()}</button>`);
}
$('#h-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-n]'); if (!li) return;
  const n = Number(li.dataset.n);
  const pdf = e.target.closest('[data-pdf]');
  if (pdf) return download(`/api/invoices/${n}/pdf?lang=${pdf.dataset.pdf}`);
  if (e.target.closest('[data-reveal]')) return api('POST', '/api/reveal', { number: n });
  if (e.target.closest('[data-del]')) {
    const ok = await confirmDialog(`Delete invoice № ${String(n).padStart(10, '0')}?`,
      '<p>Removes it from history so the number can be reused. The PDF already saved in the output folder is left untouched. Only do this if the invoice was never sent.</p>', 'Delete');
    if (!ok) return;
    try { applyState(await api('DELETE', `/api/invoices/${n}`)); historySelected = null; renderHistory(); toast('Deleted'); }
    catch (err) { toast(err.message, 'error'); }
    return;
  }
  historySelected = n; renderHistory();
});

// ---------- settings ----------
const SETTINGS_SCHEMA = [
  ['Supplier (you)', [
    ['supplier.name', 'Company name', 'i18n'], ['supplier.address', 'Address', 'i18n'], ['supplier.city', 'City', 'i18n'],
    ['supplier.country', 'Country', 'i18n'], ['supplier.mol', 'Representative (МОЛ)', 'i18n'],
    ['supplier.eik', 'ЕИК / Булстат'], ['supplier.vatNumber', 'VAT № (only if registered)'],
    ['supplier.phone', 'Phone'], ['supplier.email', 'Email'],
  ]],
  ['Bank', [['supplier.bank.name', 'Bank name'], ['supplier.bank.iban', 'IBAN'], ['supplier.bank.bic', 'BIC']]],
  ['Client', [
    ['client.name', 'Company name', 'i18n'], ['client.address', 'Address', 'i18n'], ['client.city', 'City / state / ZIP', 'i18n'],
    ['client.country', 'Country', 'i18n'], ['client.mol', 'Representative', 'i18n'],
    ['client.taxId', 'Tax ID / Reg. №'], ['client.vatNumber', 'VAT №'], ['client.phone', 'Phone'], ['client.email', 'Email'],
  ]],
  ['Line item', [['item.description', 'Description ({month}, {year})', 'i18n'], ['item.unit', 'Unit', 'i18n']]],
  ['Tax & legal', [
    ['vat.rate', 'VAT rate %', 'number'], ['vat.exemptReason', 'VAT exemption basis', 'i18n'],
    ['paymentMethod', 'Payment method', 'i18n'], ['compiledBy', 'Compiled by (Съставил)', 'i18n'], ['footerNote', 'Footer note', 'i18n'],
    ['dualCurrency', 'Show BGN equivalent', ['auto', 'always', 'never']],
  ]],
  ['Invoice colors', [
    ['colors.accent', 'Accent (band, labels, badge)', 'color'], ['colors.background', 'Page background & "Сума за плащане" text', 'color'],
    ['colors.text', 'Main text', 'color'], ['colors.muted', 'Secondary text', 'color'],
    ['colors.line', 'Borders, lines & "Сума за плащане" box', 'color'], ['colors.panel', 'Boxes background', 'color'],
  ]],
  ['General', [
    ['startNumber', 'First invoice number (if no history)', 'number'], ['defaultAmount', 'Default amount (EUR)', 'number'],
    ['defaultLang', 'Default language', ['bg', 'en']], ['outputDir', 'Output folder (absolute or relative)'],
  ]],
];
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

function renderSettings() {
  const s = app.state.settings;
  const input = (name, val, type = 'text') => `<input name="${name}" type="${type}" value="${esc(val)}" class="field ${type === 'color' ? '!h-10 !p-1' : ''}">`;
  $('#settings-form').innerHTML = SETTINGS_SCHEMA.map(([title, fields]) => `
    <fieldset class="space-y-3">
      <legend class="mb-3 text-xs font-semibold uppercase tracking-widest text-teal-300/80">${title}</legend>
      ${title === 'Invoice colors' ? themesHtml() : ''}
      ${fields.map(([p, label, kind]) => {
        const v = getPath(s, p);
        if (kind === 'i18n') return `<div><span class="label">${label}</span><div class="grid gap-2">
          <div class="relative"><span class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-zinc-600">BG</span>${input(p + '.bg', v?.bg)}</div>
          <div class="relative"><span class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-zinc-600">EN</span>${input(p + '.en', v?.en)}</div></div></div>`;
        if (Array.isArray(kind)) return `<label class="block"><span class="label">${label}</span><select name="${p}" class="field">${kind.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
        if (kind === 'color') return `<label class="block"><span class="label">${label}</span><div class="relative">
          <span data-swatch class="absolute left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-md ring-1 ring-white/20" style="background:${esc(v)}"></span>
          <input name="${p}" value="${esc(v)}" data-hex maxlength="7" spellcheck="false" autocomplete="off" class="field !pl-10 font-mono uppercase" placeholder="#RRGGBB"></div></label>`;
        return `<label class="block"><span class="label">${label}</span>${input(p, v, kind === 'number' ? 'number" step="any' : 'text')}</label>`;
      }).join('')}
    </fieldset>`).join('') +
    `<div class="sticky bottom-0 -mx-5 border-t border-white/[0.06] bg-zinc-900/90 px-5 py-3 backdrop-blur"><button class="btn-primary w-full">Save settings</button>
     <p class="mt-2 text-center text-[11px] text-zinc-500">Issued invoices keep the data they were created with. Optional logo: data/logo.png or .svg</p></div>`;
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (v) => { v = v.trim(); if (v && v[0] !== '#') v = '#' + v; return v.toLowerCase(); };

function themesHtml() {
  const themes = app.state.settings.themes || [];
  const dots = (c) => ['background', 'text', 'accent', 'line', 'panel', 'muted'].map((k) => `<span class="size-3 rounded-full ring-1 ring-white/20" style="background:${esc(c[k])}"></span>`).join('');
  return `<div class="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
    <span class="label !mb-0">Themes</span>
    <ul class="space-y-1.5">${themes.length ? themes.map((t, i) => `
      <li class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
        <span class="flex -space-x-1">${dots(t.colors)}</span>
        <span class="flex-1 truncate text-sm">${esc(t.name)}</span>
        <button type="button" class="btn-ghost !px-2.5 !py-1 text-xs" data-theme-apply="${i}">Apply</button>
        <button type="button" class="icon-btn !size-7" data-theme-del="${i}" title="Delete theme">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </li>`).join('') : '<li class="px-2 py-1 text-xs text-zinc-500">No saved themes yet.</li>'}</ul>
    <div class="flex gap-2"><input id="theme-name" class="field !py-2" placeholder="Theme name">
      <button type="button" class="btn-ghost shrink-0 !py-2" id="theme-save">Save current</button></div>
  </div>`;
}

function readColors() {
  const colors = {};
  for (const el of $$('#settings-form [data-hex]')) {
    const v = normHex(el.value);
    if (!HEX.test(v)) throw new Error(`Invalid HEX color: "${el.value}"`);
    colors[el.name.split('.')[1]] = v;
  }
  return colors;
}

async function saveSettingsPatch(patch, msg) {
  const s = { ...structuredClone(app.state.settings), ...patch };
  applyState(await api('PUT', '/api/settings', s));
  toast(msg); previewSingle(true);
}

$('#settings-form').addEventListener('input', (e) => {
  if (!e.target.matches('[data-hex]')) return;
  const v = normHex(e.target.value);
  const ok = HEX.test(v);
  e.target.classList.toggle('!border-rose-400/60', !ok && e.target.value !== '');
  if (ok) e.target.parentElement.querySelector('[data-swatch]').style.background = v;
});

$('#settings-form').addEventListener('click', async (e) => {
  const themes = [...(app.state.settings.themes || [])];
  try {
    if (e.target.closest('#theme-save')) {
      const name = $('#theme-name').value.trim();
      if (!name) return toast('Enter a theme name', 'error');
      const colors = readColors();
      const i = themes.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) themes[i] = { name, colors }; else themes.push({ name, colors });
      await saveSettingsPatch({ themes, colors }, `Theme "${name}" saved`);
    } else if (e.target.closest('[data-theme-apply]')) {
      const t = themes[e.target.closest('[data-theme-apply]').dataset.themeApply];
      await saveSettingsPatch({ colors: { ...app.state.settings.colors, ...t.colors } }, `Applied "${t.name}"`);
    } else if (e.target.closest('[data-theme-del]')) {
      const i = Number(e.target.closest('[data-theme-del]').dataset.themeDel);
      const [t] = themes.splice(i, 1);
      if (!(await confirmDialog(`Delete theme "${t.name}"?`, '<p>Current invoice colors stay as they are.</p>', 'Delete'))) return;
      await saveSettingsPatch({ themes }, `Deleted "${t.name}"`);
    }
  } catch (err) { toast(err.message, 'error'); }
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { readColors(); } catch (err) { return toast(err.message, 'error'); }
  const s = structuredClone(app.state.settings);
  for (const el of e.target.elements) {
    if (!el.name) continue;
    setPath(s, el.name, el.type === 'number' ? Number(el.value) : el.matches('[data-hex]') ? normHex(el.value) : el.value);
  }
  try { applyState(await api('PUT', '/api/settings', s)); toast('Settings saved'); previewSingle(true); }
  catch (err) { toast(err.message, 'error'); }
});

// ---------- state ----------
function applyState(st) {
  app.state = { settings: st.settings, invoices: st.invoices, nextNumber: st.nextNumber };
  $('#next-number').textContent = String(st.nextNumber).padStart(10, '0');
  $('#parties').textContent = `${st.settings.supplier.name.en} → ${st.settings.client.name.en}`;
  if (!sAmount.value && st.settings.defaultAmount) sAmount.value = st.settings.defaultAmount;
  renderSettings();
}

(async function init() {
  try {
    applyState(await api('GET', '/api/state'));
    renderRows();
    setLang(app.lang || app.state.settings.defaultLang || 'bg');
    setTab(app.tab);
  } catch (e) { toast('Server not reachable: ' + e.message, 'error'); }
})();
