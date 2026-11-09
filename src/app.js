// Grid engine: a camera over a sparse 2D world of project spaces.
// Keyboard-first, virtualized to a radius around the focused space.

const RADIUS = 3; // cells rendered around the focused space

// The map plate is pinned in world coordinates, not to the camera, so the
// terrain stays under the same squares as you walk.
const MAP = { x: -2600, y: -2465, w: 5200, h: 4929 };

const viewport = document.getElementById('viewport');
const track = document.getElementById('track');
const plane = document.getElementById('plane');
const lattice = track.querySelector('.lattice');
const floorCanvas = document.getElementById('floor');
const terrain = track.querySelector('.terrain');
const live = document.getElementById('live');
const readout = document.getElementById('readout');
const counter = document.getElementById('counter');
const clock = document.getElementById('clock');
const index = document.getElementById('index');
const indexToggle = document.getElementById('index-toggle');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let spaces = []; // ordered the way the index numbers them
const byId = new Map();
const nodes = new Map(); // id -> <a>, only for spaces near the camera
let focusedId = null;
let metrics = { w: 300, h: 276, pitchX: 340, pitchY: 316 };

const pad = (value) => String(value).padStart(2, '0');

/* ---------------- layout ---------------- */

// A 4x4-cell tile of hand-cut grid lines. Jitter is zero on every cell
// boundary, so adjacent cells and tiles meet exactly; the tile is pinned to
// world coordinates in layoutFloor().
function makeGridTile() {
  const cells = 4;
  const unit = 400;
  const size = cells * unit;
  const step = 28;
  const amp = 3.4;

  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const jitter = (v) => (v % unit === 0 ? 0 : (rand() * 2 - 1) * amp);

  const paths = [];
  for (let i = 0; i < cells; i += 1) {
    const y = i * unit;
    let d = `M0 ${y}`;
    for (let x = step; x < size; x += step) d += ` L${x} ${y + jitter(x)}`;
    paths.push(`${d} L${size} ${y}`);
  }
  for (let i = 0; i < cells; i += 1) {
    const x = i * unit;
    let d = `M${x} 0`;
    for (let y = step; y < size; y += step) d += ` L${x + jitter(y)} ${y}`;
    paths.push(`${d} L${x} ${size}`);
  }

  const color = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}"><g fill="none" stroke="${color}" stroke-width="1">` +
    paths.map((d) => `<path d="${d}"/>`).join('') +
    '</g></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function measure() {
  // Size cells so a lane of neighbours is always in frame: an array you cannot
  // see the edges of does not read as an array.
  const base = Math.min(viewport.clientWidth / 4.6, viewport.clientHeight / 3.4);
  const w = Math.round(Math.min(Math.max(base, 190), 330));
  const h = Math.round(w * 0.9);
  metrics = {
    w,
    h,
    // Extra room between cells: upright plaques need air behind them or each
    // row covers the one in front once the floor falls away.
    pitchX: Math.round(w * 1.35),
    pitchY: Math.round(h * 1.55),
  };

  const style = document.documentElement.style;
  style.setProperty('--cell-w', `${metrics.w}px`);
  style.setProperty('--cell-h', `${metrics.h}px`);
  style.setProperty('--pitch-x', `${metrics.pitchX}px`);
  style.setProperty('--pitch-y', `${metrics.pitchY}px`);

  lattice.style.backgroundImage = makeGridTile();
}

// The floor only needs to exist as far as you can see. Keeping it bounded also
// keeps it from crossing the camera plane, where a tilted element disappears.
function layoutFloor(space) {
  const { pitchX, pitchY } = metrics;
  const columns = 10;
  const behind = 8;
  const ahead = 2;

  const left = (space.x - columns) * pitchX;
  const top = (space.y - behind) * pitchY;
  const width = columns * 2 * pitchX;
  const height = (behind + ahead) * pitchY;

  for (const layer of [floorCanvas, lattice]) {
    if (!layer) continue;
    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
  }

  lattice.style.backgroundSize = `${pitchX}px ${pitchY}px`;
}

/* ---------------- floor synth ---------------- */

// Hydra draws the floor. It runs its own GL context into #floor, which lies on
// the same tilted plane as the grid, so the pattern is part of the world rather
// than a screen overlay. The scene is ambient: it never depends on where you are.

const FLOOR_FPS = 30;
const FLOOR_TEXELS = 1024;

let synth = null;
let floorTimer = 0;
let floorLast = 0;

function floorAspect() {
  const { pitchX, pitchY } = metrics;
  return (20 * pitchX) / (10 * pitchY);
}

function drawFloor(dt) {
  if (!synth) return;
  try {
    synth.tick(dt);
  } catch (error) {
    stopFloor();
    console.warn('floor synth stopped:', error);
  }
}

function startFloor() {
  if (!synth || floorTimer) return;
  floorLast = performance.now();
  floorTimer = setInterval(() => {
    const now = performance.now();
    const dt = now - floorLast;
    floorLast = now;
    drawFloor(dt);
  }, 1000 / FLOOR_FPS);
}

function stopFloor() {
  if (floorTimer) clearInterval(floorTimer);
  floorTimer = 0;
}

function syncFloor() {
  if (!synth) return;
  if (reducedMotion.matches || document.hidden) {
    stopFloor();
    drawFloor(1000 / FLOOR_FPS); // one still frame
  } else {
    startFloor();
  }
}

/* ---------------- floor scenes ---------------- */

// Each scene paints the floor once, ending with .out(field.o0). One is picked
// at random on load; ?scene=<name> forces a specific one for checking.
// `field` is synth.synth: hydra's API surface (osc, noise, src, o0, time, ...).
// Scenes differ wildly in brightness, so each sets its own canvas opacity.

const FLOOR_SCENES = [
  {
    name: 'lattice',
    opacity: 0.18,
    build(field) {
      field.osc(7, 0.04, 1.1)
        .kaleid(6)
        .rotate(0.12, 0.008)
        .color(1, 0.4, 0.12)
        .out(field.o0);
    },
  },
  {
    name: 'interference',
    opacity: 0.18,
    build(field) {
      field.osc(100, -0.0018, 0.17)
        .diff(field.osc(20, 0.00008).rotate(Math.PI / 0.00003))
        .modulateScale(
          field.noise(1.5, 0.18).modulateScale(field.osc(13).rotate(() => Math.sin(field.time / 22))),
          3,
        )
        .color(11, 0.5, 0.4, 0.9, 0.2, 0.011, 5, 22, 0.5, -1)
        .contrast(1.4)
        .add(field.src(field.o0).modulate(field.o0, 0.04), 0.6, 0.9)
        .invert()
        .brightness(0.0003, 2)
        .contrast(0.5, 2, 0.1, 2)
        .color(4, -2, 0.1)
        .modulateScale(field.osc(2), -0.2, 2, 1, 0.3)
        .posterize(200)
        .rotate(1, 0.2, 0.01, 0.001)
        .color(22, -2, 0.5, 0.5, 0.0001, 0.1, 0.2, 8)
        .contrast(0.18, 0.3, 0.1, 0.2, 0.03, 1)
        .brightness(0.0001, -1, 10)
        .out(field.o0);
    },
  },
  {
    name: 'prism',
    opacity: 0.17,
    build(field) {
      const r = (min = 0, max = 1) => Math.random() * (max - min) + min;
      field.solid(1, 1, 1)
        .diff(
          field
            .shape([0.231, 4, 4, 24].smooth().fast(0.5), r(0.6, 0.93), 0.09)
            .repeat(20, 10.605),
        )
        .modulateScale(field.osc(8).rotate(r(-0.5, 0.653)), 0.52)
        .add(
          field
            .src(field.o0)
            .scale(0.965)
            .rotate(0.012 * Math.round(r(-2, 1)))
            .color(r(), r(), r())
            .modulateRotate(field.o0, r(0, 0.5))
            .brightness(0.15),
          0.7,
        )
        .out(field.o0);
      field.speed = 1.2;
    },
  },
  {
    name: 'petals',
    opacity: 0.07,
    build(field) {
      field
        .shape(99, 0.15, 0.5)
        .color(0, 1, 2)
        .diff(
          field.shape(240, 0.5, 0).scrollX(0.05).rotate(() => field.time / 10).color(1, 0, 0.75),
        )
        .diff(
          field.shape(99, 0.4, 0.002).scrollX(0.1).rotate(() => field.time / 2.313).color(1, 0, 0.75),
        )
        .diff(
          field.shape(99, 0.3, 0.002).scrollX(0.15).rotate(() => field.time / 30).color(1, 0, 0.75),
        )
        .diff(
          field.shape(99, 0.2, 0.002).scrollX(0.2).rotate(() => field.time / 40).color(1, 0, 0.75),
        )
        .diff(
          field.shape(99, 0.1, 0.002).scrollX(0.25).rotate(() => field.time / 50).color(1, 0, 0.75),
        )
        .modulateScale(
          field.shape(240, 0.5, 0).scrollX(0.05).rotate(() => field.time / 10),
          () => Math.sin(field.time / 3) * 0.2 + 0.2,
        )
        .scale(1.6, 0.6, 1)
        .out(field.o0);
    },
  },
  {
    name: 'feedback',
    opacity: 0.33,
    build(field) {
      // The snippet reads a.fft, hydra's microphone feed. The floor runs with
      // detectAudio: false, so this stands in a spectrum that drifts with time.
      const a = {
        get fft() {
          const t = field.time;
          return [
            0.3 + 0.2 * Math.sin(t / 3),
            0.35 + 0.2 * Math.sin(t / 5),
            0.4 + 0.2 * Math.sin(t / 7),
            0.2,
          ];
        },
      };

      field
        .noise()
        .color(() => a.fft[2] * 2, 0, 0.6)
        .modulate(field.noise(() => a.fft[0] * 7.28))
        .scale(() => a.fft[2] * 5)
        .layer(
          field
            .src(field.o0)
            .mask(field.osc(10).modulateRotate(field.osc(), 90, 0.702))
            .scale(() => a.fft[0] * 2)
            .luma(0.2, 0.471),
        )
        .blend(field.o0)
        .out(field.o0);

      field
        .osc()
        .modulate(field.noise(() => a.fft[1] + 5))
        .color(1, 0.298, 0.725)
        .out(field.o1);

      field
        .src(field.o0)
        .modulate(field.o1)
        .layer(field.src(field.o1).mask(field.o1).saturate(7))
        .modulateRotate(field.o1)
        .rotate(() => ((field.time % 360) * 0.05))
        .out(field.o2);

      field.render(field.o2);
    },
  },
  {
    name: 'kaleido',
    opacity: 0.85,
    build(field) {
      field
        .noise(25.861)
        .colorama(1)
        .posterize(2)
        .kaleid(50)
        .mask(field.shape(25, 0.25).modulateScale(field.noise(400.5, 0.5)))
        .mask(field.shape(400, 1, 2.985))
        .modulateScale(field.osc(6, 0.125, 0.05).kaleid(50))
        .mult(field.osc(19.042, 0.05, 4.418).kaleid(50), 0.25)
        .scale(1.75, 0.65, 0.5)
        .modulate(field.noise(0.535))
        .saturate(6)
        .posterize(4, 0.316)
        .scale(1.5)
        .out(field.o0);
    },
  },
  {
    name: 'drift',
    opacity: 0.7,
    build(field) {
      field
        .osc(20, 0.03, 1.7)
        .kaleid()
        .mult(field.osc(20, 0.001, 0.285).rotate(1.58))
        .blend(field.o0, 0.94)
        .modulateScale(field.osc(10, 0), -0.03)
        .scale(0.8, () => 1.356 + 0.132 * Math.sin(0.054 * field.time))
        .out(field.o0);
    },
  },
];

function buildScene(field) {
  const wanted = new URLSearchParams(location.search).get('scene');
  const chosen = wanted
    ? FLOOR_SCENES.find((scene) => scene.name === wanted)
    : FLOOR_SCENES[Math.floor(Math.random() * FLOOR_SCENES.length)];

  // A scene can throw while building; fall through to the others rather than
  // leave the floor blank. Each attempt starts from a clean output and speed.
  const order = chosen ? [chosen, ...FLOOR_SCENES.filter((other) => other !== chosen)] : FLOOR_SCENES;
  for (const scene of order) {
    try {
      field.speed = 1;
      field.render(field.o0);
      scene.build(field);
      if (floorCanvas) floorCanvas.style.opacity = String(scene.opacity);
      return scene.name;
    } catch (error) {
      console.warn(`floor scene "${scene.name}" failed:`, error);
    }
  }
  return null;
}

function initFloor() {
  if (!floorCanvas || typeof window.Hydra !== 'function') return;

  const aspect = floorAspect();
  const width = FLOOR_TEXELS;
  const height = Math.max(2, Math.round(width / aspect));

  try {
    synth = new window.Hydra({
      canvas: floorCanvas,
      width,
      height,
      detectAudio: false,
      enableStreamCapture: false,
      makeGlobal: false,
      autoLoop: false,
      numSources: 0,
      numOutputs: 4,
    });
  } catch (error) {
    console.warn('floor synth unavailable:', error);
    synth = null;
    return;
  }

  const field = synth.synth;
  synth.setResolution(width, height);

  // Every name is reached through the field object: the synth is created with
  // makeGlobal: false, so `osc`, `noise`, `src`, `time` and `o0` are not
  // globals here. Time comes from field.time, which hydra updates on each tick.
  const scene = buildScene(field);
  if (scene) document.documentElement.dataset.floor = scene;

  syncFloor();
}

document.addEventListener('visibilitychange', syncFloor);
reducedMotion.addEventListener('change', syncFloor);

function focused() {
  return byId.get(focusedId);
}

function applyCamera(animate) {
  const space = focused();
  if (!space) return;

  const { pitchX, pitchY } = metrics;
  layoutFloor(space);

  // The camera looks down a floor. The focused plaque stands on the front edge
  // of its cell, so the pivot of the tilt is that plaque's base: it stays
  // unscaled at the bottom of the screen while the rest falls away behind it.
  const px = space.x * pitchX + pitchX / 2;
  const py = space.y * pitchY + pitchY;
  const anchor = viewport.clientHeight * 0.86;

  const moving = animate && !reducedMotion.matches;
  track.style.transition = moving ? '' : 'none';
  plane.style.transition = moving ? '' : 'none';

  track.style.transform =
    `translate3d(${Math.round(viewport.clientWidth / 2 - px)}px, ` +
    `${Math.round(anchor - py)}px, 0)`;
  plane.style.transform =
    `translate3d(${px}px, ${py}px, 0) rotateX(var(--tilt)) ` +
    `translate3d(${-px}px, ${-py}px, 0)`;
}

/* ---------------- rendering ---------------- */

function createNode(space) {
  const el = document.createElement('a');
  el.className = 'space';
  el.href = `/p/${space.id}/`;
  el.dataset.id = space.id;
  el.setAttribute('aria-label', `${space.title}. Space ${space.x}, ${space.y}. ${space.summary}`);
  const { w, h, pitchX, pitchY } = metrics;
  el.style.left = `${Math.round(space.x * pitchX + (pitchX - w) / 2)}px`;
  // The plaque stands on the front edge of its cell, not centred in it.
  el.style.top = `${Math.round(space.y * pitchY + pitchY - h)}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;

  const number = document.createElement('span');
  number.className = 'space__index';
  number.textContent = pad(space.n);

  const title = document.createElement('h2');
  title.className = 'space__title';
  title.textContent = space.title;

  const meta = document.createElement('span');
  meta.className = 'space__meta';
  meta.textContent = (space.tags ?? []).join(' · ');

  const marker = document.createElement('span');
  marker.className = 'space__marker';
  marker.setAttribute('aria-hidden', 'true');

  el.append(number, title, meta, marker);

  if (space.cover) {
    const cover = document.createElement('img');
    cover.className = 'space__cover';
    cover.src = space.cover;
    cover.alt = '';
    cover.loading = 'lazy';
    cover.decoding = 'async';
    cover.draggable = false;

    const scrim = document.createElement('span');
    scrim.className = 'space__scrim';
    scrim.setAttribute('aria-hidden', 'true');

    el.append(cover, scrim);
    el.classList.add('space--media');
  }

  plane.append(el);
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
  if (!space) return;
  readout.textContent = `space ${space.x},${space.y} — ${space.title}`;
  counter.textContent = `${pad(space.n)}/${pad(spaces.length)}`;
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

    // Weighted so a straight neighbour beats a diagonal one.
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

/* ---------------- index overlay ---------------- */

function setIndexOpen(open) {
  index.classList.toggle('is-open', open);
  indexToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    index.querySelector('a')?.focus();
  } else {
    indexToggle.focus({ preventScroll: true });
  }
}

indexToggle.addEventListener('click', () => {
  setIndexOpen(!index.classList.contains('is-open'));
});

// The skip link exists for keyboard users; with JS the index is a panel, so
// opening it is the useful equivalent of jumping to the anchor.
document.querySelector('.skip').addEventListener('click', (event) => {
  event.preventDefault();
  setIndexOpen(true);
});

index.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-id]');
  if (!link) return;
  event.preventDefault();
  setIndexOpen(false);
  focusSpace(link.dataset.id, { focusDom: true });
});

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

  if (key === 'escape') {
    if (index.classList.contains('is-open')) {
      event.preventDefault();
      setIndexOpen(false);
    }
    return;
  }

  if (key === 'i') {
    event.preventDefault();
    setIndexOpen(!index.classList.contains('is-open'));
    return;
  }

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
  // Touch is direct manipulation: the floor follows the finger, so the camera
  // has to travel the opposite way. Mouse, trackpad and clicks are unaffected.
  if (Math.abs(dx) > Math.abs(dy)) move(-Math.sign(dx), 0);
  else move(0, -Math.sign(dy));
});

// Deep links can change without a reload (same-document navigation), so the
// camera has to follow the hash, not just read it at boot.
window.addEventListener('hashchange', () => {
  const space = initialSpace();
  if (space && space.id !== focusedId) focusSpace(space.id);
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

function tickClock() {
  const now = new Date();
  clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function initialSpace() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim();
  if (raw) {
    if (byId.has(raw)) return byId.get(raw);
    const coords = raw.match(/^(-?\d+),(-?\d+)$/);
    if (coords) {
      const match = spaces.find((s) => s.x === Number(coords[1]) && s.y === Number(coords[2]));
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

  tickClock();
  setInterval(tickClock, 15000);

  focusedId = initialSpace().id;
  measure();
  applyCamera(false);
  renderVisible();
  // The floor is decoration: a synth failure must never take the grid down.
  try {
    initFloor();
  } catch (error) {
    console.warn('floor synth skipped:', error);
  }

  requestAnimationFrame(() => {
    applyCamera(false);
    document.documentElement.dataset.ready = 'true';
  });
}

boot();
