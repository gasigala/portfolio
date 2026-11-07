// Grid engine: a camera over a sparse 2D world of project "spaces".
// No dependencies. Rendering is virtualized to a radius around the focused space.

const RADIUS = 3; // cells rendered around the focused space

const viewport = document.getElementById('viewport');
const track = document.getElementById('track');
const lattice = track.querySelector('.lattice');
const live = document.getElementById('live');
const readout = document.getElementById('readout');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let spaces = [];
const byId = new Map();
const nodes = new Map(); // id -> <a>, only for spaces near the camera
let focusedId = null;
let metrics = { w: 320, h: 288, pitchX: 360, pitchY: 328 };

/* ---------------- layout ---------------- */

function measure() {
  // Size cells so a lane of neighbours is always in view: the grid only reads
  // as a grid if you can see that there is somewhere to go.
  const base = Math.min(viewport.clientWidth / 4.4, viewport.clientHeight / 3.4);
  const w = Math.round(Math.min(Math.max(base, 200), 340));
  const h = Math.round(w * 0.92);
  metrics = {
    w,
    h,
    pitchX: w + Math.round(w * 0.13),
    pitchY: h + Math.round(h * 0.14),
  };

  const style = document.documentElement.style;
  style.setProperty('--cell-w', `${metrics.w}px`);
  style.setProperty('--cell-h', `${metrics.h}px`);
  style.setProperty('--pitch-x', `${metrics.pitchX}px`);
  style.setProperty('--pitch-y', `${metrics.pitchY}px`);

  // The lattice is anchored to the world origin at an exact multiple of the
  // pitch, so its dots land on cell centres without per-frame math.
  const kx = Math.ceil(3200 / metrics.pitchX);
  const ky = Math.ceil(3200 / metrics.pitchY);
  lattice.style.left = `${-kx * metrics.pitchX}px`;
  lattice.style.top = `${-ky * metrics.pitchY}px`;
  lattice.style.width = `${2 * kx * metrics.pitchX}px`;
  lattice.style.height = `${2 * ky * metrics.pitchY}px`;
  lattice.style.backgroundSize = `${metrics.pitchX}px ${metrics.pitchY}px`;
}

function focused() {
  return byId.get(focusedId);
}

function applyCamera(animate) {
  const space = focused();
  if (!space) return;
  const cx = space.x * metrics.pitchX + metrics.w / 2;
  const cy = space.y * metrics.pitchY + metrics.h / 2;
  track.style.transition = animate && !reducedMotion.matches ? '' : 'none';
  track.style.transform =
    `translate3d(${Math.round(viewport.clientWidth / 2 - cx)}px, ` +
    `${Math.round(viewport.clientHeight / 2 - cy)}px, 0)`;
}

/* ---------------- rendering ---------------- */

function createNode(space) {
  const el = document.createElement('a');
  el.className = 'space';
  el.href = `/p/${space.id}/`;
  el.dataset.id = space.id;
  el.setAttribute('aria-label', `${space.title}. Space ${space.x}, ${space.y}. ${space.summary}`);
  el.style.left = `${space.x * metrics.pitchX}px`;
  el.style.top = `${space.y * metrics.pitchY}px`;
  el.style.width = `${metrics.w}px`;
  el.style.height = `${metrics.h}px`;

  const coords = document.createElement('span');
  coords.className = 'space__coords';
  coords.textContent = `${space.x}, ${space.y}`;

  const title = document.createElement('h2');
  title.className = 'space__title';
  title.textContent = space.title;

  const summary = document.createElement('p');
  summary.className = 'space__summary';
  summary.textContent = space.summary;

  el.append(coords, title, summary);

  if (space.tags?.length) {
    const tags = document.createElement('ul');
    tags.className = 'space__tags';
    for (const tag of space.tags) {
      const item = document.createElement('li');
      item.textContent = tag;
      tags.append(item);
    }
    el.append(tags);
  }

  const open = document.createElement('span');
  open.className = 'space__open';
  open.textContent = 'open';
  el.append(open);

  track.append(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  return el;
}

function renderVisible() {
  const space = focused();
  if (!space) return;

  const wanted = new Set();
  for (const candidate of spaces) {
    if (Math.abs(candidate.x - space.x) <= RADIUS && Math.abs(candidate.y - space.y) <= RADIUS) {
      wanted.add(candidate.id);
    }
  }

  for (const [id, el] of nodes) {
    if (!wanted.has(id)) {
      el.remove();
      nodes.delete(id);
    }
  }
  for (const id of wanted) {
    if (!nodes.has(id)) nodes.set(id, createNode(byId.get(id)));
  }

  syncFocus();
}

function syncFocus() {
  for (const [id, el] of nodes) {
    const on = id === focusedId;
    el.classList.toggle('is-focused', on);
    el.tabIndex = on ? 0 : -1;
  }
  const space = focused();
  if (space) {
    readout.textContent = `space ${space.x}, ${space.y} — ${space.title}`;
  }
}

function rebuild() {
  for (const el of nodes.values()) el.remove();
  nodes.clear();
  renderVisible();
}

/* ---------------- navigation ---------------- */

function nextInDirection(dx, dy) {
  const current = focused();
  let best = null;
  let bestScore = Infinity;

  for (const space of spaces) {
    if (space.id === current.id) continue;
    const vx = space.x - current.x;
    const vy = space.y - current.y;
    const forward = dx !== 0 ? vx : vy;
    const sideways = dx !== 0 ? vy : vx;

    if (Math.sign(forward) !== (dx !== 0 ? dx : dy)) continue;
    if (Math.abs(forward) < Math.abs(sideways)) continue;

    // Weight the sideways offset so a straight neighbour beats a diagonal one.
    const score = Math.abs(forward) + Math.abs(sideways) * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = space;
    }
  }
  return best;
}

function move(dx, dy) {
  const target = nextInDirection(dx, dy);
  if (!target) return;
  focusSpace(target.id, { focusDom: true });
}

function focusSpace(id, options = {}) {
  if (!byId.has(id)) return;
  focusedId = id;
  renderVisible();
  applyCamera(true);
  history.replaceState(null, '', `#/${id}`);

  const space = focused();
  live.textContent = `${space.title}. Space ${space.x}, ${space.y}.`;
  if (options.focusDom) nodes.get(id)?.focus({ preventScroll: true });
}

/* ---------------- input ---------------- */

const KEYS = {
  arrowup: [0, -1], w: [0, -1], k: [0, -1],
  arrowdown: [0, 1], s: [0, 1], j: [0, 1],
  arrowleft: [-1, 0], a: [-1, 0], h: [-1, 0],
  arrowright: [1, 0], d: [1, 0], l: [1, 0],
};

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key.toLowerCase();
  const direction = KEYS[key];
  if (direction) {
    event.preventDefault();
    move(direction[0], direction[1]);
    return;
  }
  if (key === 'home') {
    event.preventDefault();
    focusSpace(byId.get('about') ? 'about' : spaces[0].id, { focusDom: true });
  }
});

track.addEventListener('click', (event) => {
  const el = event.target.closest('.space');
  if (!el) return;
  // First click walks to the space; a click on the space you already occupy
  // follows the link to its own page.
  if (el.dataset.id !== focusedId) {
    event.preventDefault();
    focusSpace(el.dataset.id);
  }
});

let wheelAccum = { x: 0, y: 0 };
let wheelLockedUntil = 0;

viewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (performance.now() < wheelLockedUntil) return;

  wheelAccum.x += event.deltaX;
  wheelAccum.y += event.deltaY;
  if (Math.hypot(wheelAccum.x, wheelAccum.y) < 70) return;

  if (Math.abs(wheelAccum.y) >= Math.abs(wheelAccum.x)) {
    move(0, Math.sign(wheelAccum.y));
  } else {
    move(Math.sign(wheelAccum.x), 0);
  }
  wheelAccum = { x: 0, y: 0 };
  wheelLockedUntil = performance.now() + 380;
}, { passive: false });

let swipeStart = null;

viewport.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse') return;
  swipeStart = { x: event.clientX, y: event.clientY };
});

viewport.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.hypot(dx, dy) < 45) return;
  if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0);
  else move(0, Math.sign(dy));
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    measure();
    rebuild();
    applyCamera(false);
  }, 120);
});

/* ---------------- boot ---------------- */

function initialSpace() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim();
  if (raw) {
    if (byId.has(raw)) return byId.get(raw);
    const coords = raw.match(/^(-?\d+),(-?\d+)$/);
    if (coords) {
      const match = spaces.find(
        (s) => s.x === Number(coords[1]) && s.y === Number(coords[2]),
      );
      if (match) return match;
    }
  }
  return byId.get('about') ?? spaces[0];
}

function boot() {
  const source = document.getElementById('data');
  const data = source ? JSON.parse(source.textContent) : {};
  spaces = data.spaces ?? [];

  if (!spaces.length) {
    live.textContent = 'No spaces found.';
    return;
  }

  for (const space of spaces) byId.set(space.id, space);

  const start = initialSpace();
  focusedId = start.id;

  measure();
  applyCamera(false);
  renderVisible();

  requestAnimationFrame(() => {
    applyCamera(false);
    document.documentElement.dataset.ready = 'true';
  });
}

boot();
