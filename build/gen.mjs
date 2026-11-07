// Static generator: src/projects.json -> dist/
// Produces the grid shell, one crawlable page per space (html + markdown),
// a machine-readable index, llms.txt, sitemap, robots and a 404 page.
// No dependencies.

import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const data = JSON.parse(await readFile(join(SRC, 'projects.json'), 'utf8'));
const site = data.site ?? {};
const spaces = data.spaces ?? [];

const siteUrl = (process.env.SITE_URL ?? site.url ?? '').replace(/\/+$/, '');
if (!siteUrl) throw new Error('site.url is required in projects.json (or set SITE_URL)');

/* ------------------------------ validation ------------------------------ */

const errors = [];
const seenIds = new Set();
const seenCoords = new Set();

spaces.forEach((space, index) => {
  const where = `spaces[${index}]`;
  if (!space.id || !/^[a-z0-9-]+$/.test(space.id)) {
    errors.push(`${where}.id must be lowercase kebab-case, got ${JSON.stringify(space.id)}`);
  } else if (seenIds.has(space.id)) {
    errors.push(`${where}.id "${space.id}" is duplicated`);
  }
  seenIds.add(space.id);

  if (!Number.isInteger(space.x) || !Number.isInteger(space.y)) {
    errors.push(`${where} needs integer x and y`);
  } else {
    const coord = `${space.x},${space.y}`;
    if (seenCoords.has(coord)) errors.push(`${where} reuses coordinate ${coord}`);
    seenCoords.add(coord);
  }

  for (const field of ['title', 'summary']) {
    if (!space[field]) errors.push(`${where}.${field} is required`);
  }
  for (const link of space.links ?? []) {
    if (!/^https?:\/\//.test(link.href ?? '')) {
      errors.push(`${where} has a non-absolute link: ${JSON.stringify(link.href)}`);
    }
  }
});

if (errors.length) {
  console.error(`projects.json is invalid:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}

/* ------------------------------ helpers ------------------------------ */

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const escapeXml = escapeHtml;

// JSON destined for a <script> block must not be able to close the tag.
const scriptJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

const pageUrl = (space) => `${siteUrl}/p/${space.id}/`;

const ordered = [...spaces].sort((a, b) => a.y - b.y || a.x - b.x);
const neighbours = new Map(
  ordered.map((space, index) => [
    space.id,
    { previous: ordered[index - 1], next: ordered[index + 1] },
  ]),
);

async function write(relativePath, contents) {
  const target = join(DIST, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/* ------------------------------ markdown ------------------------------ */

function markdownFor(space) {
  const lines = [`# ${space.title}`, '', space.summary, ''];
  for (const paragraph of space.body ?? []) lines.push(paragraph, '');
  if (space.tags?.length) lines.push(`Tags: ${space.tags.join(', ')}`, '');
  if (space.links?.length) {
    lines.push('## Links', '');
    for (const link of space.links) lines.push(`- [${link.label}](${link.href})`);
    lines.push('');
  }
  lines.push(`Canonical: ${pageUrl(space)}`, `Back to the grid: ${siteUrl}/#/${space.id}`);
  return `${lines.join('\n')}\n`;
}

function indexMarkdown() {
  const lines = [`# ${site.owner ?? site.title}`, '', site.description, '', '## Spaces', ''];
  for (const space of ordered) {
    lines.push(`- [${space.title}](${pageUrl(space)}) — ${space.summary}`);
  }
  lines.push('', `Canonical: ${siteUrl}/`);
  return `${lines.join('\n')}\n`;
}

/* ------------------------------ html ------------------------------ */

const pageStyles = `
:root{--bg:#0a0b0d;--fg:#e9e9e6;--muted:#80848d;--line:#1d2026;--accent:#c9f24b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:400 16px/1.65 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:38rem;margin:0 auto;padding:5rem 1.5rem 7rem}
a{color:var(--fg);text-decoration:none;border-bottom:1px solid #2c3138}
a:hover{color:var(--accent);border-color:var(--accent)}
.back{font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);border:0}
.back:hover{color:var(--accent)}
h1{font-size:2rem;line-height:1.15;letter-spacing:-.02em;margin:1.6rem 0 .6rem}
h2{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:2.6rem 0 .9rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
p{margin:0 0 1rem;color:#c6c9d0}
.coords{font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:.35rem;list-style:none;padding:0;margin:1.4rem 0 0}
.tags li{font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:#6f8a24;border:1px solid #23282f;border-radius:999px;padding:.3rem .5rem}
.links{list-style:none;padding:0;margin:0}
.links li{padding:.55rem 0;border-top:1px solid var(--line)}
nav.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:4rem;padding-top:1.4rem;border-top:1px solid var(--line);font-size:.85rem;color:var(--muted)}
nav.pager a{border:0;color:var(--muted)}
nav.pager a:hover{color:var(--accent)}
`;

function pageJsonLd(space) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: space.title,
    description: space.summary,
    url: pageUrl(space),
    isPartOf: { '@type': 'CollectionPage', name: site.title, url: `${siteUrl}/` },
    author: { '@type': 'Person', name: site.owner, url: site.github },
    ...(space.tags?.length ? { keywords: space.tags.join(', ') } : {}),
  };
}

function renderSpacePage(space) {
  const { previous, next } = neighbours.get(space.id);
  const body = (space.body ?? []).map((paragraph) => `      <p>${escapeHtml(paragraph)}</p>`).join('\n');
  const tags = space.tags?.length
    ? `      <ul class="tags">\n${space.tags.map((tag) => `        <li>${escapeHtml(tag)}</li>`).join('\n')}\n      </ul>\n`
    : '';
  const links = space.links?.length
    ? `      <h2>Links</h2>\n      <ul class="links">\n${space.links
        .map((link) => `        <li><a href="${escapeHtml(link.href)}" rel="noopener">${escapeHtml(link.label)}</a></li>`)
        .join('\n')}\n      </ul>\n`
    : '';
  const pager = [
    previous
      ? `<a rel="prev" href="/p/${previous.id}/">← ${escapeHtml(previous.title)}</a>`
      : '<span></span>',
    next ? `<a rel="next" href="/p/${next.id}/">${escapeHtml(next.title)} →</a>` : '<span></span>',
  ].join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(space.title)} — ${escapeHtml(site.title)}</title>
<meta name="description" content="${escapeHtml(space.summary)}">
<link rel="canonical" href="${pageUrl(space)}">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(space.title)}">
<meta property="og:description" content="${escapeHtml(space.summary)}">
<meta property="og:url" content="${pageUrl(space)}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${scriptJson(pageJsonLd(space))}</script>
<style>${pageStyles}</style>
</head>
<body>
  <main>
    <a class="back" href="/#/${space.id}">← back to the grid</a>
    <p class="coords">space ${space.x}, ${space.y}</p>
    <h1>${escapeHtml(space.title)}</h1>
    <p>${escapeHtml(space.summary)}</p>
${body}
${tags}${links}
    <nav class="pager">
      ${pager}
    </nav>
  </main>
</body>
</html>
`;
}

/* ------------------------------ build ------------------------------ */

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const template = await readFile(join(SRC, 'index.template.html'), 'utf8');

const noscriptItems = ordered
  .map(
    (space) =>
      `    <li><a href="/p/${space.id}/">${escapeHtml(space.title)}</a><span>${escapeHtml(space.summary)}</span></li>`,
  )
  .join('\n');

const homeJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ProfilePage',
  name: site.title,
  description: site.description,
  url: `${siteUrl}/`,
  mainEntity: {
    '@type': 'Person',
    name: site.owner,
    url: site.github,
    ...(site.github ? { sameAs: [site.github] } : {}),
  },
  hasPart: ordered.map((space) => ({
    '@type': 'WebPage',
    name: space.title,
    url: pageUrl(space),
    description: space.summary,
  })),
};

const inlineData = {
  site: { title: site.title, owner: site.owner },
  spaces: ordered.map((space) => ({
    id: space.id,
    x: space.x,
    y: space.y,
    title: space.title,
    summary: space.summary,
    tags: space.tags ?? [],
  })),
};

const home = template
  .replaceAll('{{TITLE}}', escapeHtml(site.title ?? ''))
  .replaceAll('{{OWNER}}', escapeHtml(site.owner ?? ''))
  .replaceAll('{{DESCRIPTION}}', escapeHtml(site.description ?? ''))
  .replaceAll('{{URL}}', siteUrl)
  .replaceAll('{{JSONLD}}', scriptJson(homeJsonLd))
  .replaceAll('{{NOSCRIPT}}', noscriptItems)
  .replaceAll('{{DATA}}', scriptJson(inlineData));

await write('index.html', home);
await write('index.md', indexMarkdown());

for (const space of spaces) {
  await write(`p/${space.id}/index.html`, renderSpacePage(space));
  await write(`p/${space.id}/index.md`, markdownFor(space));
}

await write(
  'api/projects.json',
  `${JSON.stringify(
    {
      site: { title: site.title, owner: site.owner, url: `${siteUrl}/` },
      spaces: ordered.map((space) => ({
        ...space,
        url: pageUrl(space),
      })),
    },
    null,
    2,
  )}\n`,
);

const llms = [
  `# ${site.owner ?? site.title}`,
  '',
  `> ${site.description}`,
  '',
  'Every project lives on a space of a two-dimensional grid. Each space has its own',
  'static page; the grid is only a way to move between them.',
  '',
  '## Spaces',
  '',
  ...ordered.map((space) => `- [${space.title}](${pageUrl(space)}): ${space.summary}`),
  '',
  '## Machine-readable',
  '',
  `- [Project data](${siteUrl}/api/projects.json): all spaces with coordinates, tags and links`,
  `- [Full text](${siteUrl}/llms-full.txt): every page as plain text`,
  '',
].join('\n');
await write('llms.txt', llms);

const llmsFull = [
  `# ${site.owner ?? site.title}`,
  '',
  `> ${site.description}`,
  '',
  ...ordered.flatMap((space) => ['---', '', markdownFor(space)]),
].join('\n');
await write('llms-full.txt', llmsFull);

const lastmod = new Date().toISOString().slice(0, 10);
const sitemapEntries = [
  `  <url><loc>${siteUrl}/</loc><lastmod>${lastmod}</lastmod><priority>1.0</priority></url>`,
  ...ordered.map(
    (space) => `  <url><loc>${escapeXml(pageUrl(space))}</loc><lastmod>${lastmod}</lastmod></url>`,
  ),
];
await write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>
`,
);

// llms.txt is a proposal, not a standard; robots.txt is the reliable signal.
const aiAgents = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];
await write(
  'robots.txt',
  [
    'User-agent: *',
    'Allow: /',
    '',
    '# AI crawlers and answer engines are welcome here.',
    ...aiAgents.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n'),
);

await write(
  '404.html',
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No space here — ${escapeHtml(site.title ?? '')}</title>
<meta name="robots" content="noindex">
<style>${pageStyles}</style>
</head>
<body>
  <main>
    <a class="back" href="/">← back to the grid</a>
    <h1>No space here</h1>
    <p>That coordinate is empty. The grid only exists where a project does.</p>
  </main>
</body>
</html>
`,
);

for (const asset of ['app.css', 'app.js', '_headers']) {
  await copyFile(join(SRC, asset), join(DIST, asset));
}

console.log(`built ${spaces.length} spaces -> dist/`);
