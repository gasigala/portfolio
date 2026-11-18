// Text-only mirror negotiation for AI agents and scrapers.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const accept = request.headers.get('Accept') ?? '';
    const md = accept.indexOf('text/markdown');

    if ((request.method === 'GET' || request.method === 'HEAD') && md !== -1) {
      const html = accept.indexOf('text/html');
      if (html === -1 || md < html) {
        const mirror = await env.ASSETS.fetch(
          new URL(url.pathname.replace(/\/?$/, '/index.md'), url.origin),
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
    }

    const res = await env.ASSETS.fetch(request);
    if (!(res.headers.get('Content-Type') ?? '').includes('text/html')) return res;
    const out = new Response(res.body, res);
    out.headers.set('Vary', 'Accept');
    return out;
  },
};
