// Builds the static site: src/layout.html + src/pages/*.html -> dist/ (clean URLs), copies assets, writes sitemap and robots.
// No dependencies. Run: node build.mjs   (SITE_URL=https://pro.occpllogistics.com by default)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE_URL = (process.env.SITE_URL || 'https://pro.occpllogistics.com').replace(/\/$/, '');
const OUT = 'dist';
const NAV = [['/', 'Home'], ['/about/', 'About'], ['/services/', 'Services'], ['/customer-tools/', 'Customer Tools'],
  ['/branches/', 'Branches'], ['/careers/', 'Careers'], ['/contact/', 'Contact']];
// Structured data (JSON-LD) built from what each page visibly says, so it cannot drift from the content.
const text = (h) => h.replace(/<[^>]+>/g, ' ').replaceAll('&amp;', '&').replaceAll('&nbsp;', ' ').replace(/\s+/g, ' ').trim();
const ld = (data) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...data }).replaceAll('<', '\\u003c')}</script>`;
function structuredData(slug, path, meta, body) {
  if (slug === '404') return '';
  const org = { '@id': `${SITE_URL}/#org` };
  if (slug === 'index') return ld({ '@type': 'WebSite', name: 'OCCPL Logistics', url: `${SITE_URL}/`, inLanguage: 'en-IN', publisher: org });
  const name = text((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, meta.title])[1]);
  const out = [ld({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name, item: SITE_URL + path }] })];
  if (slug === 'faq') out.push(ld({ '@type': 'FAQPage', mainEntity: [...body.matchAll(/<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((x) => (
    { '@type': 'Question', name: text(x[1]), acceptedAnswer: { '@type': 'Answer', text: text(x[2]) } })) }));
  if (slug === 'services') out.push(...[...body.matchAll(/<article id="([^"]+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2><p[^>]*>([\s\S]*?)<\/p>/g)].map((x) => ld(
    { '@type': 'Service', name: text(x[2]), description: text(x[3]), url: `${SITE_URL}${path}#${x[1]}`, provider: org, areaServed: 'IN' })));
  return out.join('\n');
}

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
    .replaceAll('{{year}}', String(new Date().getFullYear())).replace('{{robots}}', () => slug === '404' ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE_URL}${path}">\n<meta name="robots" content="index,follow,max-image-preview:large">`)
    .replace('{{jsonld}}', () => structuredData(slug, path, meta, body)).replace('{{nav}}', nav).replace('{{body}}', () => body);
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
