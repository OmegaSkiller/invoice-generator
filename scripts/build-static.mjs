// Builds the GitHub Pages (browser-only) version into dist/.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://omegaskiller.github.io/invoice-generator/';
const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };

execSync('npx tailwindcss -i ./src/app.css -o ./public/app.css --minify', { cwd: ROOT, stdio: 'inherit' });
fs.rmSync(DIST, { recursive: true, force: true });
cp(path.join(ROOT, 'public'), DIST);
cp(path.join(ROOT, 'src/shared'), path.join(DIST, 'shared'));
for (const f of ['inter-latin-wght-normal.woff2', 'inter-cyrillic-wght-normal.woff2'])
  cp(path.join(ROOT, 'node_modules/@fontsource-variable/inter/files', f), path.join(DIST, 'fonts', f));
for (const f of ['single.png', 'invoice-bg.png', 'og-image.png'])
  if (fs.existsSync(path.join(ROOT, 'docs/screenshots', f))) cp(path.join(ROOT, 'docs/screenshots', f), path.join(DIST, f === 'og-image.png' ? f : `screenshots/${f}`));

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="bg" href="${SITE}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}"/>
    <image:image><image:loc>${SITE}og-image.png</image:loc></image:image>
    <image:image><image:loc>${SITE}screenshots/single.png</image:loc></image:image>
    <image:image><image:loc>${SITE}screenshots/invoice-bg.png</image:loc></image:image>
  </url>
</urlset>
`);
const indexFile = path.join(DIST, 'index.html');
fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="app-mode" content="static">'));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(DIST, '404.html'));
console.log('✓ dist/ ready');
