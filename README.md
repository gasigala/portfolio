# portfolio

A personal site that is a **two-dimensional grid** you move around in. Arrow keys,
WASD, swipes, or clicks walk you to the nearest space in that direction; each
space is a project.

Vanilla HTML, CSS, and JavaScript. No runtime dependencies, no framework, no build
bundler. Hosted as static assets on Cloudflare Workers.

## Why the layout is built this way

The grid is real DOM, positioned in 2D and moved with a GPU transform, not a
`<canvas>`. That keeps text selectable, findable with ctrl-F, readable by screen
readers, and — most importantly — crawlable.

The grid alone would be invisible to search engines and AI agents, so every space
also gets its own static page with its own URL:

| URL | What it is |
| --- | --- |
| `/` | the grid (single page app) |
| `/p/<id>/` | one static, fully crawlable page per space |
| `/p/<id>/index.md` | the same page as markdown |
| `/api/projects.json` | every space with coordinates, tags and links |
| `/llms.txt`, `/llms-full.txt` | plain-text index for LLMs |
| `/sitemap.xml`, `/robots.txt` | crawler entry points |

`src/worker.js` also does content negotiation: send `Accept: text/markdown` to any
HTML URL and you get the markdown mirror of that URL instead.

## Layout

```
src/
  projects.json          all content, one object per space
  index.template.html    shell for the grid
  app.css
  app.js                 grid engine (camera, virtualization, input)
  worker.js              static assets + markdown negotiation
  _headers               security headers
build/
  gen.mjs                projects.json -> dist/
  check.mjs              assertions on the generated output
wrangler.jsonc
```

`dist/` is generated and gitignored. It is what gets deployed.

## Commands

```sh
npm install
npm run build      # generate dist/ and verify it
npm run dev        # build, then serve locally at :8787
npm run deploy     # build, then deploy to Cloudflare
```

Wrangler needs Node 22 or newer.

## Adding a space

Add an object to `spaces` in [src/projects.json](src/projects.json) and pick
coordinates that do not collide:

```json
{
  "id": "my-project",
  "x": 3,
  "y": -1,
  "kind": "project",
  "title": "My Project",
  "summary": "One sentence, shown on the card and in search results.",
  "tags": ["Dart", "web"],
  "links": [{ "label": "Repository", "href": "https://github.com/gasigala/my-project" }],
  "body": ["First paragraph of the page.", "Second paragraph."]
}
```

`npm run build` fails loudly on duplicate ids, duplicate coordinates, missing
required fields, or non-absolute links, and then checks the generated pages.

The grid is sparse on purpose: a coordinate without a space is empty. It renders
only the spaces within three cells of where you are standing, so the world can
grow without slowing down.

## Interaction

| Input | Effect |
| --- | --- |
| arrows / WASD / hjkl | move to the nearest space in that direction |
| wheel / trackpad | same, debounced and axis-locked |
| swipe | same, on touch |
| click a neighbour | walk there |
| click the space you are on | open its page |
| Enter (when a space has focus) | open its page |
| `i` or the INDEX button | open the index of all spaces; Esc closes it |
| Home | back to the first space |

`#/<id>` or `#/<x>,<y>` in the URL restores your position on reload, and the
camera follows hash changes, so the browser's back button works.

## Design

The visual language is borrowed from [jai-paul.com](https://jai-paul.com/): pure
black ground, a single warm accent (`#ff4a17`), hairline rules, and 10px
uppercase monospace pinned to the corners as a HUD — name top-left, clock
top-centre, `INDEX nn/tt` top-right, position and controls along the bottom.

The grid itself is drawn as graph paper aligned to the world origin, with each
plaque centred inside its square. Nothing is rounded, nothing glows, and there
are no card shadows: the focused space is marked only by the accent border and a
small diamond, the way the reference marks where you are standing.

## Deploy

Deployment runs on Cloudflare Workers Builds: the repo is connected to a Worker,
`npm run build` runs on every push, and `main` goes to production with a preview
URL per pull request.

For a manual deploy:

```sh
npx wrangler login
npm run deploy
```

The public URL lives in `site.url` in [src/projects.json](src/projects.json),
which is the base for canonical URLs, the sitemap, and `llms.txt`. Change it
there when you attach a custom domain; `SITE_URL=... npm run build` overrides it
for a one-off build.
