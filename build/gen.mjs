// Static generator: src/projects.json -> dist/
// Produces the grid shell, one crawlable page per space (html + markdown),
// a machine-readable index, llms.txt, sitemap, robots and a 404 page.
// No dependencies.

import { readFile, writeFile, mkdir, rm, copyFile, cp, access } from 'node:fs/promises';
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

/* ------------------------------ covers ------------------------------ */

// A cover is the sleeve for a space: one image that represents the project.
// Declare `cover` in projects.json to use real artwork; otherwise the build
// generates a deterministic placeholder so the layout is always exercised.

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const coverOf = (space) => {
  const declared = space.cover;
  return {
    src: declared ?? `/img/${space.id}.svg`,
    placeholder: !declared,
    raster: Boolean(declared) && !declared.endsWith('.svg'),
    alt: space.coverAlt ?? `${space.title} cover image`,
  };
};

const hash = (value) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const pad2 = (value) => String(value).padStart(2, '0');

// Four sleeves, picked from the id, so a wall of placeholders is not uniform.
// The canvas is 1200px but plaques render at ~265px, so every stroke is sized
// to survive that downscale.
function sleeveMotif(seed) {
  const kind = ['hatch', 'arcs', 'dots', 'bars'][seed % 4];
  const parts = [];

  if (kind === 'hatch') {
    for (let i = -1200; i < 1200; i += 176) {
      parts.push(
        `<line x1="${i}" y1="1200" x2="${i + 1200}" y2="0" stroke="rgba(255,74,23,0.28)" stroke-width="16"/>`,
      );
    }
  } else if (kind === 'arcs') {
    for (let r = 160; r <= 640; r += 120) {
      const alpha = r > 460 ? 0.16 : 0.3;
      parts.push(
        `<circle cx="600" cy="600" r="${r}" fill="none" stroke="rgba(255,74,23,${alpha})" stroke-width="16"/>`,
      );
    }
  } else if (kind === 'dots') {
    for (let y = 130; y < 1200; y += 190) {
      for (let x = 130; x < 1200; x += 190) {
        parts.push(`<circle cx="${x}" cy="${y}" r="28" fill="rgba(255,74,23,0.26)"/>`);
      }
    }
  } else {
    for (let i = 0; i < 9; i += 1) {
      const height = 120 + ((seed >> (i % 16)) % 6) * 110;
      parts.push(
        `<rect x="${72 + i * 120}" y="${1140 - height}" width="56" height="${height}" fill="rgba(255,74,23,0.28)"/>`,
      );
    }
  }

  return `<g>${parts.join('')}</g>`;
}

function placeholderCover(space) {
  const seed = hash(space.id);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
<rect width="1200" height="1200" fill="#000"/>
${sleeveMotif(seed)}
<text x="72" y="1128" font-family="${MONO}" font-size="24" letter-spacing="7" fill="rgba(217,213,204,0.24)">placeholder</text>
</svg>
`;
}

/* ------------------------------ markdown ------------------------------ */

function markdownFor(space) {
  const cover = coverOf(space);
  const lines = [`# ${space.title}`, '', space.summary, ''];
  if (cover.raster) lines.push(`![${cover.alt}](${siteUrl}${cover.src})`, '');
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
:root{--bg:#000;--ink:#d9d5cc;--muted:rgba(217,213,204,.42);--faint:rgba(217,213,204,.16);--line:rgba(217,213,204,.14);--accent:#ff4a17;--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 13px/1.85 var(--mono);-webkit-font-smoothing:antialiased}
main{max-width:40rem;margin:0 auto;padding:3.2rem 1.2rem 6rem}
a{color:inherit;text-decoration:none}
a:hover{color:var(--accent)}
.top{display:flex;justify-content:space-between;gap:1rem;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line);padding-bottom:.8rem}
.top a:hover{color:var(--accent)}
h1{margin:2.2rem 0 .9rem;font-size:21px;line-height:1.4;font-weight:400;letter-spacing:.09em;text-transform:uppercase}
p{margin:0 0 1.1rem;color:#a9a59c}
.lede{color:var(--ink)}
h2{margin:2.8rem 0 .7rem;font-size:10px;font-weight:400;letter-spacing:.2em;text-transform:uppercase;color:var(--faint)}
.meta{margin:1.5rem 0 0;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.cover{margin:0 0 2.4rem}
.cover img{display:block;width:100%;height:auto;border:1px solid var(--line)}
.links{list-style:none;margin:0;padding:0}
.links li{border-top:1px solid var(--line);padding:.62rem 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
.links li:last-child{border-bottom:1px solid var(--line)}
nav.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:3.5rem;padding-top:1rem;border-top:1px solid var(--line);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
`;

function pageJsonLd(space) {
  const cover = coverOf(space);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: space.title,
    description: space.summary,
    url: pageUrl(space),
    isPartOf: { '@type': 'CollectionPage', name: site.title, url: `${siteUrl}/` },
    author: { '@type': 'Person', name: site.owner, url: site.github },
    ...(space.tags?.length ? { keywords: space.tags.join(', ') } : {}),
    ...(cover.raster ? { image: `${siteUrl}${cover.src}` } : {}),
  };
}

function renderSpacePage(space) {
  const { previous, next } = neighbours.get(space.id);
  const number = ordered.findIndex((entry) => entry.id === space.id) + 1;
  const cover = coverOf(space);
  const body = (space.body ?? []).map((paragraph) => `      <p>${escapeHtml(paragraph)}</p>`).join('\n');
  const tags = space.tags?.length
    ? `      <p class="meta">${escapeHtml(space.tags.join(' · '))}</p>\n`
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
${cover.raster ? `<meta property="og:image" content="${siteUrl}${cover.src}">` : ''}
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${scriptJson(pageJsonLd(space))}</script>
<style>${pageStyles}</style>
</head>
<body>
  <main>
    <div class="top">
      <a href="/#/${space.id}">← grid</a>
      <span>space ${space.x},${space.y}</span>
      <span>${pad2(number)}/${pad2(ordered.length)}</span>
    </div>
    <h1>${escapeHtml(space.title)}</h1>
    <p class="lede">${escapeHtml(space.summary)}</p>
    <figure class="cover">
      <img src="${cover.src}" alt="${escapeHtml(cover.alt)}" width="1200" height="1200" loading="lazy" decoding="async">
    </figure>
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

// Anything in public/ is served as-is: real covers, favicons, fonts.
const PUBLIC = join(ROOT, 'public');
try {
  await cp(PUBLIC, DIST, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const template = await readFile(join(SRC, 'index.template.html'), 'utf8');

const noscriptItems = ordered
  .map((space, index) => {
    const number = String(index + 1).padStart(2, '0');
    return (
      `    <li><a href="/p/${space.id}/" data-id="${space.id}">` +
      `<span class="index__no">${number}</span>` +
      `<span class="index__title">${escapeHtml(space.title)}</span>` +
      `<span class="index__at">${space.x},${space.y}</span></a></li>`
    );
  })
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
  spaces: ordered.map((space, index) => ({
    id: space.id,
    n: index + 1,
    x: space.x,
    y: space.y,
    title: space.title,
    summary: space.summary,
    tags: space.tags ?? [],
    cover: coverOf(space).src,
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

// Covers: use the declared artwork if it exists on disk, otherwise generate a
// placeholder sleeve. A declared cover that is missing is a build error.
for (const [index, space] of ordered.entries()) {
  const cover = coverOf(space);

  if (cover.placeholder) {
    await write(`img/${space.id}.svg`, placeholderCover(space));
    continue;
  }

  try {
    await access(join(DIST, cover.src));
  } catch {
    errors.push(
      `spaces[${space.id}].cover "${cover.src}" is declared but the file is not in public/`,
    );
  }
}

if (errors.length) {
  console.error(`build failed:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}

await write(
  'api/projects.json',
  `${JSON.stringify(
    {
      site: { title: site.title, owner: site.owner, url: `${siteUrl}/` },
      spaces: ordered.map((space) => ({
        ...space,
        cover: coverOf(space).src,
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
    <div class="top">
      <a href="/">← grid</a>
      <span>404</span>
      <span>&nbsp;</span>
    </div>
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

// The floor synth is a vendored UMD bundle: a devDependency copied in at build
// time so the site itself still has no runtime dependencies.
const HYDRA = join(ROOT, 'node_modules', 'hydra-synth', 'dist', 'hydra-synth.js');
try {
  await copyFile(HYDRA, join(DIST, 'hydra-synth.js'));
} catch (error) {
  throw new Error(`hydra-synth is not installed: run npm install (${error.message})`);
}

console.log(`built ${spaces.length} spaces -> dist/`);
