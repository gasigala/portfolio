// Post-build assertions. Runs as part of `npm run build` so a broken page
// fails the deploy instead of shipping.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');

const data = JSON.parse(await readFile(join(ROOT, 'src/projects.json'), 'utf8'));
const siteUrl = (process.env.SITE_URL ?? data.site.url).replace(/\/+$/, '');

const failures = [];
const read = (path) => readFile(join(DIST, path), 'utf8');
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const home = await read('index.html');
assert(!home.includes('{{'), 'index.html still has unreplaced template tokens');
assert(
  (home.match(/<li><a href="\/p\//g) ?? []).length === data.spaces.length,
  'index.html index list does not have one entry per space',
);

const homeLd = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert(Boolean(homeLd), 'index.html is missing JSON-LD');
if (homeLd) {
  try {
    JSON.parse(homeLd[1]);
  } catch (error) {
    failures.push(`index.html JSON-LD does not parse: ${error.message}`);
  }
}

for (const space of data.spaces) {
  const url = `${siteUrl}/p/${space.id}/`;
  const html = await read(`p/${space.id}/index.html`);

  assert(html.includes(`<link rel="canonical" href="${url}">`), `${space.id}: canonical is wrong`);
  assert(html.includes(`<h1>${space.title}</h1>`), `${space.id}: missing h1`);
  assert(html.includes('<title>'), `${space.id}: missing title`);

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(Boolean(ld), `${space.id}: missing JSON-LD`);
  if (ld) {
    try {
      const parsed = JSON.parse(ld[1]);
      assert(parsed.url === url, `${space.id}: JSON-LD url is wrong`);
    } catch (error) {
      failures.push(`${space.id}: JSON-LD does not parse: ${error.message}`);
    }
  }

  const markdown = await read(`p/${space.id}/index.md`);
  assert(markdown.startsWith(`# ${space.title}`), `${space.id}: markdown mirror is malformed`);
  assert(markdown.includes(url), `${space.id}: markdown mirror is missing its canonical URL`);
}

const sitemap = await read('sitemap.xml');
const sitemapUrls = sitemap.match(/<loc>/g) ?? [];
assert(
  sitemapUrls.length === data.spaces.length + 1,
  `sitemap has ${sitemapUrls.length} urls, expected ${data.spaces.length + 1}`,
);

const robots = await read('robots.txt');
assert(robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`), 'robots.txt is missing the sitemap line');

const llms = await read('llms.txt');
for (const space of data.spaces) {
  assert(llms.includes(`${siteUrl}/p/${space.id}/`), `llms.txt is missing ${space.id}`);
}

const api = JSON.parse(await read('api/projects.json'));
assert(api.spaces.length === data.spaces.length, 'api/projects.json is missing spaces');
assert(
  api.spaces.every((space) => space.url?.startsWith(siteUrl)),
  'api/projects.json has spaces without absolute urls',
);

if (failures.length) {
  console.error(`build check failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}

console.log(`checked ${data.spaces.length} space pages, sitemap, robots, llms.txt, api`);
