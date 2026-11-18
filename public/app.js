import { STRINGS, SETTINGS_SCHEMA } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const app = {
  state: null,
  lang: LS.get('uiLang', 'bg') === 'en' ? 'en' : 'bg',
  sec: LS.get('settingsSec', 'supplier'),
  tab: LS.get('tab', 'single'),
  bulkRows: LS.get('bulkRows', []),
  bulkPreview: [],
  bulkSelected: 0,
};

/** Translate a UI string (functions receive the extra args). */
const t = (k, ...a) => { const v = STRINGS[app.lang]?.[k] ?? STRINGS.bg[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
const pad10 = (n) => String(n).padStart(10, '0');

// ---------- api ----------
// Local mode: node server.js (real PDFs, output folder). Static mode: GitHub Pages (localStorage + print to PDF).
let STATIC = false;
let local = null;

async function detectMode() {
  if (document.querySelector('meta[name="app-mode"][content="static"]')) return true;
  try {
    const res = await fetch('api/state', { cache: 'no-store' });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) return false;
  } catch {}
  return true;
}

async function api(method, url, body) {
  if (STATIC) return local.localApi(method, url, body);
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function invoiceHtml(n, lang) {
  if (STATIC) return local.renderHtml(n, lang);
  return fetch(`api/invoices/${n}/html?lang=${lang}`).then((r) => (r.ok ? r.text() : ''));
}

/** Static mode: print an HTML document via a hidden iframe ("Save as PDF" in the dialog). */
function printHtml(html, title) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(f);
  f.onload = async () => {
    try { await f.contentDocument.fonts.ready; } catch {}
    const prev = document.title;
    document.title = title; // Chrome/Safari suggest this as the PDF file name
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => { document.title = prev; f.remove(); }, 1000);
  };
  f.srcdoc = html;
}

/** Download (local) or print (static) one or more issued invoices. */
function exportInvoices(numbers, lang) {
  if (STATIC) {
    const { html, title } = local.renderManyHtml(numbers, lang);
    printHtml(html, title);
    toast(t('saveAsPdf'));
    return;
  }
  if (numbers.length === 1) download(`api/invoices/${numbers[0]}/pdf${lang ? `?lang=${lang}` : ''}`);
  else download(`api/zip?numbers=${numbers.join(',')}`);
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
const eur = (n) => {
  const v = Number(n).toLocaleString(app.lang === 'en' ? 'en-GB' : 'bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return app.lang === 'en' ? `€${v}` : `${v} €`;
};
const monthLabel = (m) => {
  const l = new Date(m + '-01T00:00:00Z').toLocaleString(app.lang === 'en' ? 'en-GB' : 'bg-BG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return l.charAt(0).toUpperCase() + l.slice(1);
};
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

function confirmDialog(title, bodyHtml, okLabel = t('issue')) {
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
/** Static texts marked with data-i18n / data-i18n-title / data-i18n-aria. */
function applyI18n() {
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $('#app-main').lang = app.lang;
  $('#s-issue-label').textContent = t(STATIC ? 'issueSave' : 'issueDownload');
  $('#b-issue').textContent = t(STATIC ? 'bulkIssuePdf' : 'bulkIssueZip');
  $('#s-hint').textContent = t(STATIC ? 'hintStatic' : 'hintLocal');
  $('#credit-text').textContent = t('creditText');
  $('#credit-by').textContent = t('creditBy');
}

function setLang(l) {
  app.lang = l; LS.set('uiLang', l);
  applyI18n();
  if (app.state) { renderSettings(true); renderRows(); }
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
function setTab(tab) {
  app.tab = tab; LS.set('tab', tab);
  $('#tab-indicator').style.transform = `translateX(${TABS.indexOf(tab) * 100}%)`;
  $$('#tabs button').forEach((b) => b.classList.toggle('text-zinc-500', b.dataset.tab !== tab));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
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
    const r = await api('POST', 'api/preview', { month, amount, lang: app.lang });
    if (app.tab !== 'single' && app.tab !== 'settings') return;
    $('#s-dates').textContent = t('datesLine', dmy(r.issueDate), dmy(r.dueDate));
    $('#s-warnings').innerHTML = warningsHtml(r.warnings);
    $('#s-issue').disabled = false;
    showPreview(r.html, `№ ${r.number} · ${t('draft')}`);
  } catch (e) { toast(e.message, 'error'); }
}, 180);

sMonth.addEventListener('input', () => { LS.set('s-month', sMonth.value); previewSingle(); });
sAmount.addEventListener('input', () => { LS.set('s-amount', sAmount.value); previewSingle(); });

$('#s-issue').addEventListener('click', async () => {
  const amount = parseAmount(sAmount.value);
  if (!amount) return toast(t('validAmount'), 'error');
  const ok = await confirmDialog(t('confirmIssue', pad10(app.state.nextNumber)),
    `<p>${monthLabel(sMonth.value)} · <b class="text-zinc-100">${eur(amount)}</b> · ${app.lang.toUpperCase()}</p><p class="mt-2">${t(STATIC ? 'confirmIssueBodyStatic' : 'confirmIssueBody')}</p>`);
  if (!ok) return;
  await issue([{ month: sMonth.value, amount }]);
});

async function issue(rows) {
  const btns = [$('#s-issue'), $('#b-issue')];
  btns.forEach((b) => (b.disabled = true));
  try {
    const r = await api('POST', 'api/issue', { rows, lang: app.lang });
    applyState(r);
    r.warnings?.forEach((w) => toast(w, 'warn'));
    exportInvoices(r.issued.map((i) => i.number));
    toast(t('issuedToast', r.issued.map((i) => i.name).join(', ')));
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
      <button class="icon-btn opacity-50 group-hover:opacity-100" data-remove title="${t('remove')}">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </li>`).join('') || `<li class="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">${t('noRows')}</li>`;
  const valid = app.bulkRows.filter((r) => r.month && parseAmount(r.amount));
  $('#b-count').textContent = t('nInvoices', valid.length);
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
  if (rows.some((r) => !r)) return toast(t('pasteFormat'), 'error');
  app.bulkRows = rows; app.bulkSelected = 0;
  $('#b-paste').classList.add('hidden');
  saveRows(); renderRows(); previewBulk();
});

function showBulkSelected() {
  if (app.tab !== 'bulk') return;
  const p = app.bulkPreview[app.bulkSelected];
  showPreview(p?.html || '', p ? `№ ${p.number} · ${monthLabel(p.month)} · ${t('draft')}` : '');
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
    const r = await api('POST', 'api/preview-bulk', { rows: app.bulkRows.map((x) => ({ month: x.month, amount: parseAmount(x.amount) })), lang: app.lang });
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
  $('#b-count').textContent = t('nInvoices', valid.length);
  $('#b-total').textContent = eur(valid.reduce((s, r) => s + parseAmount(r.amount), 0));
  $('#b-issue').disabled = !valid.length || valid.length !== app.bulkRows.length;
}

$('#b-issue').addEventListener('click', async () => {
  const rows = app.bulkRows.map((r) => ({ month: r.month, amount: parseAmount(r.amount) }));
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const ok = await confirmDialog(t('confirmBulk', rows.length),
    `<ul class="space-y-1">${sorted.map((r, i) => `<li class="flex justify-between"><span>№ ${app.state.nextNumber + i} · ${monthLabel(r.month)}</span><b class="text-zinc-100">${eur(r.amount)}</b></li>`).join('')}</ul>
     <p class="mt-3">${t(STATIC ? 'confirmBulkBodyStatic' : 'confirmBulkBody')}</p>`, t('issueN', rows.length));
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
        ${STATIC ? '' : `<button class="btn-ghost !px-2.5 !py-1 text-xs" data-reveal>${t('showInFinder')}</button>`}
        ${inv.number === maxNum ? `<button class="btn-ghost ml-auto !px-2.5 !py-1 text-xs !text-rose-300 hover:!border-rose-400/30" data-del>${t('del')}</button>` : ''}
      </div>
    </li>`).join('') : `<li class="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">${t('noInvoices')}</li>`;
  if (historySelected == null && list[0]) historySelected = list[0].number;
  showHistoryPreview();
}
async function showHistoryPreview() {
  if (historySelected == null) return showPreview('', '');
  const lang = app.lang;
  const html = await invoiceHtml(historySelected, lang);
  if (app.tab !== 'history') return;
  showPreview(html, `№ ${pad10(historySelected)} · ${t('issued')}`,
    `<button class="btn-ghost !px-3 !py-1.5 text-xs" data-export="${historySelected}" data-lang="${lang}">${t(STATIC ? 'savePdf' : 'download')} ${lang.toUpperCase()}</button>`);
}
$('#h-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-n]'); if (!li) return;
  const n = Number(li.dataset.n);
  const pdf = e.target.closest('[data-pdf]');
  if (pdf) return exportInvoices([n], pdf.dataset.pdf);
  if (e.target.closest('[data-reveal]')) return api('POST', 'api/reveal', { number: n });
  if (e.target.closest('[data-del]')) {
    const ok = await confirmDialog(t('confirmDelete', pad10(n)), `<p>${t('confirmDeleteBody')}</p>`, t('del'));
    if (!ok) return;
    try { applyState(await api('DELETE', `api/invoices/${n}`)); historySelected = null; renderHistory(); toast(t('deleted')); }
    catch (err) { toast(err.message, 'error'); }
    return;
  }
  historySelected = n; renderHistory();
});

// ---------- settings ----------
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };
const legend = (key) => `<h3 class="mb-3 text-[11px] font-semibold uppercase tracking-widest text-teal-300/80">${t(key)}</h3>`;

function fieldHtml([p, label, kind], s) {
  const v = getPath(s, p);
  const lbl = label[app.lang] || label.bg;
  if (kind === 'i18n') {
    const one = (l) => `<div class="relative">
        <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">${l.toUpperCase()}</span>
        <input name="${p}.${l}" value="${esc(v?.[l])}" class="field !py-2 !pl-10" aria-label="${esc(lbl)} (${l.toUpperCase()})"></div>`;
    return `<div class="col-span-2"><span class="label">${esc(lbl)}</span><div class="grid grid-cols-2 gap-2">${one('bg')}${one('en')}</div></div>`;
  }
  if (Array.isArray(kind)) return `<label class="block"><span class="label">${esc(lbl)}</span><select name="${p}" class="field !py-2">${
    kind.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(l[app.lang] || l.bg)}</option>`).join('')}</select></label>`;
  if (kind === 'color') return `<label class="block"><span class="label">${esc(lbl)}</span><div class="relative">
      <span data-swatch class="absolute left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-md ring-1 ring-white/20" style="background:${esc(v)}"></span>
      <input name="${p}" value="${esc(v)}" data-hex maxlength="7" spellcheck="false" autocomplete="off" class="field !py-2 !pl-10 font-mono uppercase" placeholder="#RRGGBB"></div></label>`;
  const type = kind === 'number' ? 'number" step="any' : 'text';
  return `<label class="block ${kind === 'wide' ? 'col-span-2' : ''}"><span class="label">${esc(lbl)}</span><input name="${p}" type="${type}" value="${esc(v)}" class="field !py-2"></label>`;
}

function renderSettings(keepDraft = false) {
  const s = app.state.settings;
  const form = $('#settings-form');
  const draft = keepDraft ? [...form.elements].filter((e) => e.name).map((e) => [e.name, e.value]) : [];
  if (!SETTINGS_SCHEMA.some(([id]) => id === app.sec)) app.sec = 'supplier';

  const nav = `<div class="sticky top-0 z-10 -mx-5 bg-zinc-900/85 px-5 pb-4 pt-1 backdrop-blur-xl">
    <div class="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1" role="tablist">
      ${SETTINGS_SCHEMA.map(([id, title]) => `<button type="button" role="tab" data-sec="${id}" aria-selected="${id === app.sec}"
        class="sec-tab flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition duration-200 ease-smooth">${t(title)}</button>`).join('')}
    </div></div>`;

  const sections = SETTINGS_SCHEMA.map(([id, , groups]) => {
    let body = groups.map(([g, fields]) => {
      const list = fields.filter((f) => !(STATIC && f[3] === 'local'));
      return `<div>${g ? legend(g) : ''}<div class="grid grid-cols-2 items-end gap-3">${list.map((f) => fieldHtml(f, s)).join('')}</div></div>`;
    }).join('');
    if (id === 'colors') body = themesHtml() + body;
    if (id === 'general' && STATIC) body += `<div>${legend('grpBackup')}
      <p class="mb-3 text-xs leading-relaxed text-zinc-400">${t('backupText')}</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn-ghost" id="backup-export">${t('exportBackup')}</button>
        <label class="btn-ghost cursor-pointer">${t('importBackup')}<input type="file" accept="application/json,.json" id="backup-import" class="sr-only"></label>
      </div></div>`;
    return `<section data-sec-panel="${id}" class="fade-in space-y-6" ${id === app.sec ? '' : 'hidden'}>${body}</section>`;
  }).join('');

  form.innerHTML = nav + sections +
    `<div class="sticky bottom-0 -mx-5 mt-6 border-t border-white/[0.06] bg-zinc-900/90 px-5 py-3 backdrop-blur"><button class="btn-primary w-full">${t('saveSettings')}</button>
     <p class="mt-2 text-center text-[11px] text-zinc-500">${t('settingsNote')}${STATIC ? '' : ' ' + t('logoNote')}</p></div>`;
  for (const [n, v] of draft) { const el = form.elements.namedItem(n); if (el && 'value' in el) el.value = v; }
  $$('[data-hex]', form).forEach((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
  setSec(app.sec);
}

function setSec(id) {
  app.sec = id; LS.set('settingsSec', id);
  $$('#settings-form .sec-tab').forEach((b) => {
    const on = b.dataset.sec === id;
    b.setAttribute('aria-selected', on);
    b.classList.toggle('bg-white/10', on); b.classList.toggle('text-zinc-100', on);
    b.classList.toggle('text-zinc-500', !on); b.classList.toggle('hover:text-zinc-300', !on);
  });
  $$('#settings-form [data-sec-panel]').forEach((p) => (p.hidden = p.dataset.secPanel !== id));
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (v) => { v = v.trim(); if (v && v[0] !== '#') v = '#' + v; return v.toLowerCase(); };

function themesHtml() {
  const themes = app.state.settings.themes || [];
  const dots = (c) => ['background', 'text', 'accent', 'line', 'panel', 'muted'].map((k) => `<span class="size-3 rounded-full ring-1 ring-white/20" style="background:${esc(c[k])}"></span>`).join('');
  return `<div class="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
    <span class="label !mb-0">${t('themes')}</span>
    <ul class="space-y-1.5">${themes.length ? themes.map((th, i) => `
      <li class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
        <span class="flex -space-x-1">${dots(th.colors)}</span>
        <span class="flex-1 truncate text-sm">${esc(th.name)}</span>
        <button type="button" class="btn-ghost !px-2.5 !py-1 text-xs" data-theme-apply="${i}">${t('apply')}</button>
        <button type="button" class="icon-btn !size-7" data-theme-del="${i}" title="${t('deleteTheme')}">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </li>`).join('') : `<li class="px-2 py-1 text-xs text-zinc-500">${t('noThemes')}</li>`}</ul>
    <div class="flex gap-2"><input id="theme-name" class="field !py-2" placeholder="${t('themeName')}">
      <button type="button" class="btn-ghost shrink-0 !py-2" id="theme-save">${t('saveCurrent')}</button></div>
  </div>`;
}

function readColors() {
  const colors = {};
  for (const el of $$('#settings-form [data-hex]')) {
    const v = normHex(el.value);
    if (!HEX.test(v)) throw new Error(t('invalidHex', el.value));
    colors[el.name.split('.')[1]] = v;
  }
  return colors;
}

async function saveSettingsPatch(patch, msg) {
  const s = { ...structuredClone(app.state.settings), ...patch };
  applyState(await api('PUT', 'api/settings', s));
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
  const sec = e.target.closest('[data-sec]');
  if (sec) return setSec(sec.dataset.sec);
  const themes = [...(app.state.settings.themes || [])];
  try {
    if (e.target.closest('#theme-save')) {
      const name = $('#theme-name').value.trim();
      if (!name) return toast(t('enterThemeName'), 'error');
      const colors = readColors();
      const i = themes.findIndex((th) => th.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) themes[i] = { name, colors }; else themes.push({ name, colors });
      await saveSettingsPatch({ themes, colors }, t('themeSaved', name));
    } else if (e.target.closest('[data-theme-apply]')) {
      const th = themes[e.target.closest('[data-theme-apply]').dataset.themeApply];
      await saveSettingsPatch({ colors: { ...app.state.settings.colors, ...th.colors } }, t('themeApplied', th.name));
    } else if (e.target.closest('[data-theme-del]')) {
      const i = Number(e.target.closest('[data-theme-del]').dataset.themeDel);
      const [th] = themes.splice(i, 1);
      if (!(await confirmDialog(t('confirmThemeDel', th.name), `<p>${t('confirmThemeDelBody')}</p>`, t('del')))) return;
      await saveSettingsPatch({ themes }, t('themeDeleted', th.name));
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
  try { applyState(await api('PUT', 'api/settings', s)); toast(t('settingsSaved')); previewSingle(true); }
  catch (err) { toast(err.message, 'error'); }
});

$('#preview-actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]');
  if (b) exportInvoices([Number(b.dataset.export)], b.dataset.lang);
});

$('#settings-form').addEventListener('click', (e) => {
  if (!e.target.closest('#backup-export')) return;
  const blob = new Blob([JSON.stringify(local.exportBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `invoice-generator-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#settings-form').addEventListener('change', async (e) => {
  if (e.target.id !== 'backup-import' || !e.target.files[0]) return;
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const n = data.invoices?.length ?? 0;
    if (!(await confirmDialog(t('confirmImport'), `<p>${t('confirmImportBody', app.state.invoices.length, n)}</p>`, t('replace')))) return;
    applyState(local.importBackup(data)); historySelected = null; toast(t('backupImported')); refresh();
  } catch (err) { toast(err.message, 'error'); }
  finally { e.target.value = ''; }
});

// ---------- GitHub stars ----------
async function loadStars() {
  const show = (n) => { if (!Number.isFinite(n)) return; const el = $('#gh-stars'); el.textContent = n.toLocaleString('bg-BG'); el.classList.remove('hidden'); };
  const cached = LS.get('ghStars', null);
  if (cached && Date.now() - cached.at < 3600e3) return show(cached.n);
  try {
    const r = await fetch('https://api.github.com/repos/OmegaSkiller/invoice-generator', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return show(cached?.n);
    const n = (await r.json()).stargazers_count;
    LS.set('ghStars', { n, at: Date.now() }); show(n);
  } catch { show(cached?.n); }
}

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
    STATIC = await detectMode();
    if (STATIC) {
      local = await import('./local-api.js');
      document.documentElement.dataset.mode = 'static';
    }
    applyI18n();
    applyState(await api('GET', 'api/state'));
    renderRows();
    setLang(app.lang);
    setTab(app.tab);
  } catch (e) { toast(t('couldNotStart') + e.message, 'error'); }
  loadStars();
})();
