// HTML → PDF via the locally installed Chrome (puppeteer-core, no bundled Chromium).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

let browserPromise;
function browser() {
  if (!browserPromise) {
    const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
    if (!executablePath) throw new Error('No Chrome/Chromium found. Set CHROME_PATH to a Chromium-based browser.');
    browserPromise = puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] });
    browserPromise.catch(() => { browserPromise = undefined; });
  }
  return browserPromise;
}

export async function htmlToPdf(html) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise; browserPromise = undefined; await b.close(); }
}
