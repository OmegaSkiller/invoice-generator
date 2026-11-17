// Regenerates README screenshots using a throwaway dummy dataset (never touches data/).
// Usage: npm run screenshots
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/screenshots');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-demo-'));
const PORT = 4399;
const env = { ...process.env, INVOICE_DATA_DIR: tmp, PORT: String(PORT) };

fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
  outputDir: path.join(tmp, 'output'),
  startNumber: 1,
  defaultAmount: 2450,
  supplier: { bank: { name: 'Example Bank AD', iban: 'BG00XXXX00000000000000', bic: 'XXXXBGSF' } },
  colors: { accent: '#0f766e', background: '#ffffff', text: '#0f172a', muted: '#64748b', line: '#0f172a', panel: '#f8fafc' },
}));

const run = (args) => new Promise((res, rej) => {
  const p = spawn(process.execPath, ['cli.js', ...args], { cwd: ROOT, env, stdio: 'ignore' });
  p.on('exit', (c) => (c ? rej(new Error(`cli ${args} → ${c}`)) : res()));
});
await run(['bulk', '2026-07=2100', '2026-08=2350.40', '2026-09=1980', '2026-10=2475.15', '--yes']);

const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.CHROME_PATH].find((p) => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await wait(900); await page.screenshot({ path: path.join(OUT, name) }); console.log('✓', name); };

for (const lang of ['bg', 'en']) {
  const sfx = lang === 'bg' ? '' : '-en';
  await page.goto(`http://localhost:${PORT}`); await wait(800);
  await page.evaluate((lang) => { localStorage.clear(); localStorage.setItem('lang', JSON.stringify(lang)); localStorage.setItem('tab', '"single"');
    localStorage.setItem('s-month', '"2026-11"'); localStorage.setItem('s-amount', '"2450"');
    localStorage.setItem('bulkRows', JSON.stringify([{ month: '2026-11', amount: '2450' }, { month: '2026-12', amount: '2600' }, { month: '2027-01', amount: '2380.75' }])); }, lang);
  await page.reload(); await shot(`single${sfx}.png`);
  await page.click('[data-tab=bulk]'); await shot(`bulk${sfx}.png`);
  await page.click('[data-tab=history]'); await shot(`history${sfx}.png`);
}
await page.click('[data-tab=settings]');
await wait(900);
const fs_ = await page.evaluateHandle(() => [...document.querySelectorAll('legend')].find((l) => l.textContent.includes('colors')).parentElement);
await fs_.evaluate((el) => el.scrollIntoView({ block: 'center' }));
await wait(300);
await fs_.screenshot({ path: path.join(OUT, 'themes.png') }); console.log('✓ themes.png');

// full-size invoice render
await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/api/invoices/4/html?lang=bg`); await shot('invoice-bg.png');
await page.goto(`http://localhost:${PORT}/api/invoices/4/html?lang=en`); await shot('invoice-en.png');

await browser.close();
server.kill();
fs.rmSync(tmp, { recursive: true, force: true });
