import { STRINGS, SETTINGS_SCHEMA } from './i18n.js';
import { amountInWords } from './shared/words.js';

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
/** Money as HTML with muted cents: the whole part reads first, digits stay aligned. */
const moneyHtml = (n) => { const s = eur(n); const m = s.match(/^(.*?)([.,]\d{2})(.*)$/); return m ? `${esc(m[1])}<span class="cents">${m[2]}</span>${esc(m[3])}` : esc(s); };
const loc = (v) => (v && typeof v === 'object' ? v[app.lang] ?? v.bg : v) ?? '';
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
const setHtml = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
const monthLabel = (m) => {
  const l = new Date(m + '-01T00:00:00Z').toLocaleString(app.lang === 'en' ? 'en-GB' : 'bg-BG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return l.charAt(0).toUpperCase() + l.slice(1);
};
const dmy = (iso) => iso.split('-').reverse().join('.');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  const color = kind === 'error' ? 'border-rose-200 text-rose-700' : kind === 'warn' ? 'border-amber-200 text-amber-800' : 'border-line text-ink';
  el.className = `pointer-events-auto max-w-sm rounded-lg border bg-white px-4 py-3 text-sm shadow-[0_8px_24px_-8px_rgb(24_24_27/.2)] fade-in ${color}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}

function warningsHtml(list) {
  if (!list?.length) return '';
  return `<div class="fade-in space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
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
  if (app.state) { renderSettings(true); renderRows(); fillStatic(); }
  const ind = $('#lang-toggle .seg-indicator');
  ind.style.transform = l === 'en' ? 'translateX(100%)' : 'none';
  $$('#lang-toggle button, #lang-mini button').forEach((b) => {
    const on = b.dataset.lang === l;
    b.setAttribute('aria-checked', on);
    b.classList.toggle('text-ink', on);
    b.classList.toggle('text-ink-3', !on);
  });
  $$('#lang-mini button').forEach((b) => { const on = b.dataset.lang === l; b.classList.toggle('bg-card', on); b.classList.toggle('shadow-sm', on); });
  setHeader();
  refresh();
}
$$('#lang-toggle button, #lang-mini button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ---------- tabs ----------
const TABS = ['single', 'bulk', 'history', 'settings'];
function setTab(tab) {
  if (!TABS.includes(tab)) tab = 'single';
  app.tab = tab; LS.set('tab', tab);
  $$('#tabs button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  $$('[data-rail]').forEach((p) => (p.hidden = p.dataset.rail !== tab));
  setHeader();
  refresh();
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

/** Breadcrumb, title and status badge follow the active section. */
function setHeader(number) {
  if (!app.state) return;
  const next = number ?? pad10(app.state.nextNumber);
  const h = {
    single: [next, t('invoiceTitle', next), t('badgeDraft')],
    bulk: [t('tabBulk'), t('bulkTitle'), t('badgeDraft')],
    history: [t('tabHistory'), t('historyTitle'), String(app.state.invoices.length)],
    settings: [t('tabSettings'), t('settingsTitle'), ''],
  }[app.tab];
  setText('page-crumb', h[0]); setText('page-title', h[1]); setText('page-badge', h[2]);
  $('#page-badge').hidden = !h[2];
}

$('#btn-preview').addEventListener('click', () => $('#preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' }));
$('#btn-print').addEventListener('click', () => { if (lastHtml) printHtml(lastHtml, $('#page-title').textContent); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]'); if (!b) return;
  setTab(b.dataset.goto);
  if (b.dataset.secGoto) setSec(b.dataset.secGoto);
});

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
  if (!month || !amount) { showPreview('', ''); fillSummary(null); $('#s-warnings').innerHTML = ''; $('#s-issue').disabled = true; return; }
  try {
    const r = await api('POST', 'api/preview', { month, amount, lang: app.lang });
    if (app.tab !== 'single' && app.tab !== 'settings') return;
    $('#s-dates').textContent = t('datesLine', dmy(r.issueDate), dmy(r.dueDate));
    $('#s-warnings').innerHTML = warningsHtml(r.warnings);
    $('#s-issue').disabled = false;
    fillSummary({ ...r, amount, month });
    if (app.tab === 'single') setHeader(r.number);
    showPreview(r.html, `№ ${r.number} · ${t('draft')}`);
  } catch (e) { toast(e.message, 'error'); }
}, 180);

/** Live summary: every edit shows its result at once (amount, VAT, total, words, dates). */
function fillSummary(r) {
  const s = app.state.settings, rate = Number(s.vat.rate) || 0;
  if (!r) {
    for (const id of ['s-big', 'li-total', 'sum-base', 'sum-vat', 'sum-due', 'st-issue', 'st-due', 'sum-issue', 'sum-due-date']) setText(id, '—');
    setText('s-words', ''); return;
  }
  const cents = Math.round(r.amount * 100), vat = Math.round((cents * rate) / 100), total = cents + vat;
  setHtml('s-big', moneyHtml(cents / 100));
  setText('s-sub', t('serviceSub', rate));
  setText('s-words', `${t('inWords')}: ${amountInWords(total, app.lang)}`);
  setText('st-issue', dmy(r.issueDate)); setText('st-due', dmy(r.dueDate)); setText('st-number', r.number);
  setHtml('li-total', moneyHtml(cents / 100));
  setHtml('sum-base', moneyHtml(cents / 100));
  setText('sum-vat-label', t('vatN', rate));
  setHtml('sum-vat', moneyHtml(vat / 100));
  setText('sum-vat-note', rate ? '' : loc(s.vat.exemptReason));
  setHtml('sum-due', moneyHtml(total / 100));
  setText('sum-issue', dmy(r.issueDate)); setText('sum-due-date', dmy(r.dueDate));
  const [y, m] = r.month.split('-').map(Number);
  const mName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString(app.lang === 'en' ? 'en-GB' : 'bg-BG', { month: 'long', timeZone: 'UTC' });
  setText('li-desc', loc(s.item.description).replace('{month}', mName).replace('{year}', y));
}

/** Data that only changes with settings or language. */
function fillStatic() {
  const s = app.state.settings, c = s.client, p = s.supplier, rate = Number(s.vat.rate) || 0;
  setText('client-name', loc(c.name));
  setText('client-addr', [loc(c.address), loc(c.city)].filter(Boolean).join(', '));
  setText('parties', loc(p.name));
  setText('avatar', loc(p.name).split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—');
  setText('li-unit', loc(s.item.unit)); setText('li-vat', `${rate}%`);
  setText('s-pay', loc(s.paymentMethod)); setText('sum-pay', loc(s.paymentMethod)); setText('s-vat', `${rate}%`);
  setText('to-name', loc(c.name)); setText('to-email', c.email || '');
  const party = (label, x, id) => `<div class="rounded-lg bg-zinc-50 p-3.5"><p class="eyebrow mb-1.5 !text-ink-3">${esc(label)}</p>
    <p class="font-medium text-ink">${esc(loc(x.name))}</p><p class="text-ink-2">${esc([loc(x.address), loc(x.city), loc(x.country)].filter(Boolean).join(', '))}</p>
    <p class="mt-1 text-xs text-ink-3">${esc([id, x.email].filter(Boolean).join(' · '))}</p></div>`;
  setHtml('parties-detail', party(t('supplierLbl'), p, p.eik) + party(t('clientLbl'), c, c.taxId) +
    `<button type="button" class="link justify-self-start text-xs" data-goto="settings" data-sec-goto="client">${esc(t('editItem'))}</button>`);
}

sMonth.addEventListener('input', () => { LS.set('s-month', sMonth.value); previewSingle(); });
sAmount.addEventListener('input', () => { LS.set('s-amount', sAmount.value); previewSingle(); });

$('#s-issue').addEventListener('click', async () => {
  const amount = parseAmount(sAmount.value);
  if (!amount) return toast(t('validAmount'), 'error');
  const ok = await confirmDialog(t('confirmIssue', pad10(app.state.nextNumber)),
    `<p>${monthLabel(sMonth.value)} · <b class="text-ink">${eur(amount)}</b> · ${app.lang.toUpperCase()}</p><p class="mt-2">${t(STATIC ? 'confirmIssueBodyStatic' : 'confirmIssueBody')}</p>`);
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
    <li class="fade-in group -mx-2 grid grid-cols-[3rem_minmax(0,1fr)_8rem_2rem] items-center gap-2 rounded-lg px-2 py-2 transition ${i === app.bulkSelected ? 'bg-accent/[0.05]' : 'hover:bg-zinc-50'}" data-i="${i}">
      <span class="text-xs tabular-nums ${i === app.bulkSelected ? 'font-medium text-accent' : 'text-ink-3'}">${app.bulkPreview[i] ? '№' + app.bulkPreview[i].number.replace(/^0+/, '') : ''}</span>
      <input type="month" value="${esc(r.month)}" data-k="month" class="field min-w-0">
      <div class="relative"><input value="${esc(r.amount)}" data-k="amount" inputmode="decimal" placeholder="0.00" class="field !pr-7 text-right tabular-nums">
        <span class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">€</span></div>
      <button type="button" class="icon-btn !size-8 opacity-60 group-hover:opacity-100" data-remove title="${t('remove')}" aria-label="${t('remove')}">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </li>`).join('') || `<li class="py-8 text-center text-sm text-ink-3">${t('noRows')}</li>`;
  bulkSummary();
}
function bulkSummary() {
  const valid = app.bulkRows.filter((r) => r.month && parseAmount(r.amount));
  $('#b-count').textContent = valid.length;
  $('#b-total').innerHTML = moneyHtml(valid.reduce((s, r) => s + parseAmount(r.amount), 0));
  const nums = app.bulkPreview.filter(Boolean).map((p) => Number(p.number)).sort((a, b) => a - b);
  $('#b-range').textContent = nums.length ? (nums.length > 1 ? `${nums[0]}–${nums.at(-1)}` : String(nums[0])) : '—';
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
  bulkSummary();
}

$('#b-issue').addEventListener('click', async () => {
  const rows = app.bulkRows.map((r) => ({ month: r.month, amount: parseAmount(r.amount) }));
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const ok = await confirmDialog(t('confirmBulk', rows.length),
    `<ul class="space-y-1">${sorted.map((r, i) => `<li class="flex justify-between"><span>№ ${app.state.nextNumber + i} · ${monthLabel(r.month)}</span><b class="text-ink">${eur(r.amount)}</b></li>`).join('')}</ul>
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
    <li class="fade-in group -mx-2 cursor-pointer rounded-lg px-2 py-3 transition ${historySelected === inv.number ? 'bg-accent/[0.05]' : 'hover:bg-zinc-50'}" data-n="${inv.number}">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs tabular-nums ${historySelected === inv.number ? 'text-accent' : 'text-ink-3'}">№ ${pad10(inv.number)}</div>
          <div class="truncate text-sm font-medium">${monthLabel(inv.month)}</div>
        </div>
        <div class="text-right">
          <div class="text-sm font-medium tabular-nums">${moneyHtml(inv.amountCents / 100)}</div>
          <div class="text-[11px] text-ink-3">${dmy(inv.issueDate)} · ${inv.lang.toUpperCase()}</div>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <button type="button" class="link" data-pdf="bg">PDF BG</button>
        <button type="button" class="link" data-pdf="en">PDF EN</button>
        ${STATIC ? '' : `<button type="button" class="link" data-reveal>${t('showInFinder')}</button>`}
        ${inv.number === maxNum ? `<button type="button" class="link ml-auto !text-rose-600 !decoration-rose-200" data-del>${t('del')}</button>` : ''}
      </div>
    </li>`).join('') : `<li class="py-10 text-center text-sm text-ink-3">${t('noInvoices')}</li>`;
  if (historySelected == null && list[0]) historySelected = list[0].number;
  $('#h-count').textContent = list.length;
  $('#h-last').textContent = list[0] ? `№ ${list[0].number}` : '—';
  $('#h-total').innerHTML = moneyHtml(list.reduce((a, i) => a + i.amountCents, 0) / 100);
  showHistoryPreview();
}
async function showHistoryPreview() {
  $('#h-actions').innerHTML = historySelected == null ? '' : ['bg', 'en'].map((l, i) =>
    `<button type="button" class="${i ? 'btn-outline' : 'btn-primary'} w-full" data-export="${historySelected}" data-lang="${l}">${t(STATIC ? 'savePdf' : 'download')} ${l.toUpperCase()} · № ${historySelected}</button>`).join('');
  if (historySelected == null) return showPreview('', '');
  const lang = app.lang;
  const html = await invoiceHtml(historySelected, lang);
  if (app.tab !== 'history') return;
  showPreview(html, `№ ${pad10(historySelected)} · ${t('issued')}`,
    `<button type="button" class="btn-ghost !px-2.5 !py-1 text-xs" data-export="${historySelected}" data-lang="${lang}">${t(STATIC ? 'savePdf' : 'download')} ${lang.toUpperCase()}</button>`);
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
const legend = (key) => `<h3 class="eyebrow mb-4">${t(key)}</h3>`;

function fieldHtml([p, label, kind], s) {
  const v = getPath(s, p);
  const lbl = label[app.lang] || label.bg;
  if (kind === 'i18n') {
    const one = (l) => `<div class="relative">
        <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">${l.toUpperCase()}</span>
        <input name="${p}.${l}" value="${esc(v?.[l])}" class="field !pl-10" aria-label="${esc(lbl)} (${l.toUpperCase()})"></div>`;
    return `<div class="col-span-2"><span class="label">${esc(lbl)}</span><div class="grid grid-cols-2 gap-2">${one('bg')}${one('en')}</div></div>`;
  }
  if (Array.isArray(kind)) return `<label class="block"><span class="label">${esc(lbl)}</span><select name="${p}" class="field">${
    kind.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(l[app.lang] || l.bg)}</option>`).join('')}</select></label>`;
  if (kind === 'color') return `<label class="block"><span class="label">${esc(lbl)}</span><div class="relative">
      <span data-swatch class="absolute left-2 top-1/2 size-5 -translate-y-1/2 rounded ring-1 ring-black/10" style="background:${esc(v)}"></span>
      <input name="${p}" value="${esc(v)}" data-hex maxlength="7" spellcheck="false" autocomplete="off" class="field !pl-10 font-mono uppercase" placeholder="#RRGGBB"></div></label>`;
  const type = kind === 'number' ? 'number" step="any' : 'text';
  return `<label class="block ${kind === 'wide' ? 'col-span-2' : ''}"><span class="label">${esc(lbl)}</span><input name="${p}" type="${type}" value="${esc(v)}" class="field"></label>`;
}

function renderSettings(keepDraft = false) {
  const s = app.state.settings;
  const form = $('#settings-form');
  const draft = keepDraft ? [...form.elements].filter((e) => e.name).map((e) => [e.name, e.value]) : [];
  if (!SETTINGS_SCHEMA.some(([id]) => id === app.sec)) app.sec = 'supplier';

  const nav = `<div class="sticky top-0 z-10 -mx-5 rounded-t-[14px] border-b border-line-soft bg-card/90 px-5 py-4 backdrop-blur sm:-mx-6 sm:px-6">
    <div class="flex gap-0.5 overflow-x-auto rounded-lg bg-zinc-100 p-0.5" role="tablist">
      ${SETTINGS_SCHEMA.map(([id, title]) => `<button type="button" role="tab" data-sec="${id}" aria-selected="${id === app.sec}"
        class="sec-tab flex-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition duration-200 ease-smooth">${t(title)}</button>`).join('')}
    </div></div>`;

  const sections = SETTINGS_SCHEMA.map(([id, , groups]) => {
    let body = groups.map(([g, fields]) => {
      const list = fields.filter((f) => !(STATIC && f[3] === 'local'));
      return `<div>${g ? legend(g) : ''}<div class="grid grid-cols-2 items-end gap-3">${list.map((f) => fieldHtml(f, s)).join('')}</div></div>`;
    }).join('');
    if (id === 'colors') body = themesHtml() + body;
    if (id === 'general' && STATIC) body += `<div>${legend('grpBackup')}
      <p class="mb-3 text-xs leading-relaxed text-ink-2">${t('backupText')}</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="btn-outline" id="backup-export">${t('exportBackup')}</button>
        <label class="btn-outline cursor-pointer">${t('importBackup')}<input type="file" accept="application/json,.json" id="backup-import" class="sr-only"></label>
      </div></div>`;
    return `<section data-sec-panel="${id}" class="fade-in space-y-8 py-6" ${id === app.sec ? '' : 'hidden'}>${body}</section>`;
  }).join('');

  form.innerHTML = nav + sections + (STATIC ? '' : `<p class="border-t border-line-soft py-4 text-xs text-ink-3">${t('logoNote')}</p>`);
  for (const [n, v] of draft) { const el = form.elements.namedItem(n); if (el && 'value' in el) el.value = v; }
  $$('[data-hex]', form).forEach((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
  setSec(app.sec);
}

function setSec(id) {
  app.sec = id; LS.set('settingsSec', id);
  $$('#settings-form .sec-tab').forEach((b) => {
    const on = b.dataset.sec === id;
    b.setAttribute('aria-selected', on);
    b.classList.toggle('bg-card', on); b.classList.toggle('shadow-sm', on); b.classList.toggle('text-ink', on);
    b.classList.toggle('text-ink-2', !on); b.classList.toggle('hover:text-ink', !on);
  });
  $$('#settings-form [data-sec-panel]').forEach((p) => (p.hidden = p.dataset.secPanel !== id));
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (v) => { v = v.trim(); if (v && v[0] !== '#') v = '#' + v; return v.toLowerCase(); };

function themesHtml() {
  const themes = app.state.settings.themes || [];
  const dots = (c) => ['background', 'text', 'accent', 'line', 'panel', 'muted'].map((k) => `<span class="size-3 rounded-full ring-2 ring-white" style="background:${esc(c[k])}"></span>`).join('');
  return `<div class="space-y-2 rounded-lg border border-line p-3">
    <span class="label !mb-0">${t('themes')}</span>
    <ul class="space-y-1.5">${themes.length ? themes.map((th, i) => `
      <li class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50">
        <span class="flex -space-x-1">${dots(th.colors)}</span>
        <span class="flex-1 truncate text-sm">${esc(th.name)}</span>
        <button type="button" class="btn-outline !px-2.5 !py-1 text-xs" data-theme-apply="${i}">${t('apply')}</button>
        <button type="button" class="icon-btn !size-7" data-theme-del="${i}" title="${t('deleteTheme')}">
          <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </li>`).join('') : `<li class="px-2 py-1 text-xs text-ink-3">${t('noThemes')}</li>`}</ul>
    <div class="flex gap-2"><input id="theme-name" class="field" placeholder="${t('themeName')}">
      <button type="button" class="btn-outline shrink-0" id="theme-save">${t('saveCurrent')}</button></div>
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
  e.target.classList.toggle('!border-rose-500', !ok && e.target.value !== '');
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

$('#h-actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]');
  if (b) exportInvoices([Number(b.dataset.export)], b.dataset.lang);
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
  if (!sAmount.value && st.settings.defaultAmount) sAmount.value = st.settings.defaultAmount;
  renderSettings();
  fillStatic();
  setHeader();
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
