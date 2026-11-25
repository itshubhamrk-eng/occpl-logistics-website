// Builds the static site: src/layout.html + src/pages/*.html -> dist/ (clean URLs), copies assets, writes sitemap and robots.
// No dependencies. Run: node build.mjs   (SITE_URL=https://www.occpllogistics.com by default)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE_URL = (process.env.SITE_URL || 'https://www.occpllogistics.com').replace(/\/$/, '');
const OUT = 'dist';
const NAV = [['/', 'Home'], ['/about/', 'About'], ['/services/', 'Services'], ['/customer-tools/', 'Customer Tools'],
  ['/branches/', 'Branches'], ['/careers/', 'Careers'], ['/contact/', 'Contact']];
const version = Date.now().toString(36);
const layout = readFileSync('src/layout.html', 'utf8');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync('assets', join(OUT, 'assets'), { recursive: true });

const urls = [];
for (const file of readdirSync('src/pages').filter((f) => f.endsWith('.html')).sort()) {
  const raw = readFileSync(join('src/pages', file), 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\s*/);
  if (!m) throw new Error(`${file}: missing <!--{"title":..,"description":..}--> header`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const slug = file.replace(/\.html$/, '');
  const path = slug === 'index' ? '/' : slug === '404' ? '/404.html' : `/${slug}/`;
  const section = meta.nav ?? path;
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === section ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const html = layout
    .replaceAll('{{title}}', meta.title).replaceAll('{{description}}', meta.description)
    .replaceAll('{{path}}', path).replaceAll('{{siteUrl}}', SITE_URL).replaceAll('{{version}}', version)
    .replaceAll('{{year}}', String(new Date().getFullYear())).replace('{{nav}}', nav).replace('{{body}}', body);
  const target = slug === 'index' ? join(OUT, 'index.html') : slug === '404' ? join(OUT, '404.html') : join(OUT, slug, 'index.html');
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, html);
  if (slug !== '404') urls.push(path);
}
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
console.log(`Built ${urls.length} pages into ${OUT}/ for ${SITE_URL}`);
if (!existsSync(join(OUT, 'assets/js/config.js'))) throw new Error('assets/js/config.js missing');
