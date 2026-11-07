// Text-only mirror negotiation for AI agents and scrapers.
// If the client prefers markdown over html, serve the pre-generated .md mirror
// of the same URL instead of the single-page app shell.

function prefersMarkdown(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const accept = request.headers.get('Accept') ?? '';
  const md = accept.indexOf('text/markdown');
  if (md === -1) return false;
  const html = accept.indexOf('text/html');
  return html === -1 || md < html;
}

function markdownPath(pathname) {
  return pathname.endsWith('/') ? `${pathname}index.md` : `${pathname}/index.md`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (prefersMarkdown(request)) {
      const mirror = await env.ASSETS.fetch(
        new Request(new URL(markdownPath(url.pathname), url.origin), { method: 'GET' }),
      );

      if (mirror.ok) {
        return new Response(mirror.body, {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Vary': 'Accept',
            'Link': `<${url.origin}${url.pathname}>; rel="canonical"`,
            'Cache-Control': 'public, max-age=300',
          },
        });
      }
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/html')) return response;

    // The same URL serves html or markdown depending on Accept.
    const html = new Response(response.body, response);
    html.headers.set('Vary', 'Accept');
    return html;
  },
};
