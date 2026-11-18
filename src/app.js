// Grid engine: a camera over a sparse 2D world of project spaces.

const viewport = document.getElementById('viewport');
const plane = document.getElementById('plane');
const floorCanvas = document.getElementById('floor');
const live = document.getElementById('live');
const readout = document.getElementById('readout');
const counter = document.getElementById('counter');
const clock = document.getElementById('clock');
const index = document.getElementById('index');
const indexToggle = document.getElementById('index-toggle');

const pad = (value) => String(value).padStart(2, '0');

const spaces = Array.from(plane.querySelectorAll('.space'), (el, i) => ({
  el,
  id: el.dataset.id,
  x: Number(el.dataset.x),
  y: Number(el.dataset.y),
  n: pad(i + 1),
  title: el.querySelector('.space__title').textContent,
}));
const byId = new Map(spaces.map((s) => [s.id, s]));
const total = pad(spaces.length);
let current = null;
let pitchX = 340;
let pitchY = 316;
let synth = null;

/* ---------------- floor scenes ---------------- */

const FLOOR_SCENES = [
  {
    name: 'lattice',
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
    build(field) {
      let layer = field
        .shape(99, 0.15, 0.5)
        .color(0, 1, 2)
        .diff(field.shape(240, 0.5, 0).scrollX(0.05).rotate(() => field.time / 10).color(1, 0, 0.75));
      for (const [radius, sx, rate] of [[0.4, 0.1, 2.313], [0.3, 0.15, 30], [0.2, 0.2, 40], [0.1, 0.25, 50]]) {
        layer = layer.diff(
          field.shape(99, radius, 0.002).scrollX(sx).rotate(() => field.time / rate).color(1, 0, 0.75),
        );
      }
      layer
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
    build(field) {
      const fft = () => {
        const t = field.time;
        return [
          0.3 + 0.2 * Math.sin(t / 3),
          0.35 + 0.2 * Math.sin(t / 5),
          0.4 + 0.2 * Math.sin(t / 7),
        ];
      };

      field
        .noise()
        .color(() => fft()[2] * 2, 0, 0.6)
        .modulate(field.noise(() => fft()[0] * 7.28))
        .scale(() => fft()[2] * 5)
        .layer(
          field
            .src(field.o0)
            .mask(field.osc(10).modulateRotate(field.osc(), 90, 0.702))
            .scale(() => fft()[0] * 2)
            .luma(0.2, 0.471),
        )
        .blend(field.o0)
        .out(field.o0);

      field
        .osc()
        .modulate(field.noise(() => fft()[1] + 5))
        .color(1, 0.298, 0.725)
        .out(field.o1);

      field
        .src(field.o0)
        .modulate(field.o1)
        .layer(field.src(field.o1).mask(field.o1).saturate(7))
        .modulateRotate(field.o1)
        .rotate(() => (field.time % 360) * 0.05)
        .out(field.o2);

      field.render(field.o2);
    },
  },
  {
    name: 'kaleido',
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

function initFloor() {
  if (!floorCanvas || typeof window.Hydra !== 'function') return;
  try {
    synth = new window.Hydra({
      canvas: floorCanvas,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      detectAudio: false,
      enableStreamCapture: false,
      makeGlobal: false,
      autoLoop: true,
      numSources: 0,
      numOutputs: 4,
    });
    synth.setResolution(viewport.clientWidth, viewport.clientHeight);
    const wanted = new URLSearchParams(location.search).get('scene');
    const scene =
      FLOOR_SCENES.find((s) => s.name === wanted) ??
      FLOOR_SCENES[Math.floor(Math.random() * FLOOR_SCENES.length)];

    scene.build(synth.synth);
    document.documentElement.dataset.floor = scene.name;
  } catch (error) {
    console.warn('floor synth unavailable:', error);
  }
}

/* ---------------- camera & navigation ---------------- */

function applyCamera(animate) {
  if (!current) return;
  const px = (current.x + 0.5) * pitchX;
  const py = (current.y + 1) * pitchY;
  plane.style.setProperty('--cx', current.x);
  plane.style.setProperty('--cy', current.y);
  if (!animate) plane.style.transition = 'none';
  plane.style.transform =
    `translate3d(${Math.round(viewport.clientWidth / 2)}px, ${Math.round(viewport.clientHeight * 0.86)}px, 0) ` +
    `rotateX(var(--tilt)) translate3d(${-px}px, ${-py}px, 0)`;
  if (!animate) {
    plane.getBoundingClientRect();
    plane.style.transition = '';
  }
}

function layout() {
  const base = Math.min(viewport.clientWidth / 4.6, viewport.clientHeight / 3.4);
  const w = Math.round(Math.min(Math.max(base, 190), 330));
  const h = Math.round(w * 0.9);
  pitchX = Math.round(w * 1.35);
  pitchY = Math.round(h * 1.95);

  const style = document.documentElement.style;
  style.setProperty('--cell-w', `${w}px`);
  style.setProperty('--cell-h', `${h}px`);
  style.setProperty('--pitch-x', `${pitchX}px`);
  style.setProperty('--pitch-y', `${pitchY}px`);

  applyCamera(false);
  synth?.setResolution(viewport.clientWidth, viewport.clientHeight);
}

function focusSpace(id, { animate = true, focusDom = false } = {}) {
  const space = byId.get(id);
  if (!space) return;
  current = space;
  applyCamera(animate);

  for (const s of spaces) {
    const on = s === space;
    const near = Math.abs(s.x - space.x) <= 4 && s.y - space.y <= 1 && space.y - s.y <= 5;
    s.el.classList.toggle('is-focused', on);
    s.el.classList.toggle('is-visible', near);
    s.el.tabIndex = on ? 0 : -1;
  }

  readout.textContent = `space ${space.x},${space.y} — ${space.title}`;
  counter.textContent = `${space.n}/${total}`;
  live.textContent = `${space.title}. Space ${space.x}, ${space.y}.`;
  history.replaceState(null, '', `#/${id}`);
  if (focusDom) space.el.focus({ preventScroll: true });
}

function move(dx, dy) {
  let best = null;
  let bestScore = Infinity;

  for (const s of spaces) {
    if (s === current) continue;
    const forward = dx ? (s.x - current.x) * dx : (s.y - current.y) * dy;
    const sideways = Math.abs(dx ? s.y - current.y : s.x - current.x);
    if (forward <= 0 || forward < sideways) continue;

    const score = forward + sideways * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best) focusSpace(best.id, { focusDom: true });
}

/* ---------------- index overlay ---------------- */

function setIndexOpen(open) {
  index.classList.toggle('is-open', open);
  indexToggle.setAttribute('aria-expanded', String(open));
  if (open) index.querySelector('a')?.focus();
  else indexToggle.focus({ preventScroll: true });
}

indexToggle.addEventListener('click', () => setIndexOpen(!index.classList.contains('is-open')));

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

  if (key === 'escape' && index.classList.contains('is-open')) {
    event.preventDefault();
    setIndexOpen(false);
  } else if (key === 'i') {
    event.preventDefault();
    setIndexOpen(!index.classList.contains('is-open'));
  } else if (KEYS[key]) {
    event.preventDefault();
    move(KEYS[key][0], KEYS[key][1]);
  } else if (key === 'home') {
    event.preventDefault();
    focusSpace((byId.get('about') ?? spaces[0]).id, { focusDom: true });
  }
});

plane.addEventListener('click', (event) => {
  const el = event.target.closest('.space');
  if (el && el.dataset.id !== current?.id) {
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

  if (Math.abs(wheelAccum.y) >= Math.abs(wheelAccum.x)) move(0, Math.sign(wheelAccum.y));
  else move(Math.sign(wheelAccum.x), 0);

  wheelAccum = { x: 0, y: 0 };
  wheelLockedUntil = performance.now() + 380;
}, { passive: false });

let swipeStart = null;

viewport.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse') swipeStart = { x: event.clientX, y: event.clientY };
});

viewport.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.hypot(dx, dy) < 45) return;
  if (Math.abs(dx) > Math.abs(dy)) move(-Math.sign(dx), 0);
  else move(0, -Math.sign(dy));
});

/* ---------------- boot ---------------- */

function initialSpace() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim();
  if (byId.has(raw)) return byId.get(raw);
  const coords = raw.match(/^(-?\d+),(-?\d+)$/);
  if (coords) {
    const match = spaces.find((s) => s.x === Number(coords[1]) && s.y === Number(coords[2]));
    if (match) return match;
  }
  return byId.get('about') ?? spaces[0];
}

function tickClock() {
  clock.textContent = new Date().toTimeString().slice(0, 5);
}

window.addEventListener('hashchange', () => {
  const space = initialSpace();
  if (space && space !== current) focusSpace(space.id);
});

window.addEventListener('resize', layout);

tickClock();
setInterval(tickClock, 15000);
layout();
focusSpace(initialSpace().id, { animate: false });
initFloor();
