// Abstract nature backgrounds drawn on a canvas: water, wind, grass, rain, sand.
// During a session the scene follows the breath (see setBreath).
// Kept light for phones: ~30 fps, capped pixel ratio, nothing drawn when hidden.

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const SCENES = ['water', 'wind', 'grass', 'rain', 'sand', 'light'];

// Colours per theme. "a" scales every alpha: light backgrounds need stronger strokes.
const PALETTES = {
  night: {
    a: 1.7, glow: [210, 195, 150, 0.13],
    water: [150, 195, 195], waterFill: [60, 110, 120],
    thread: [200, 205, 195], threadWarm: [215, 190, 140],
    grass: [120, 150, 100], straw: [190, 170, 110],
    rain: [175, 195, 205], sand: [215, 200, 170], stone: [5, 5, 4, 0.55]
  },
  dusk: {
    a: 1.9, glow: [245, 215, 170, 0.17],
    water: [175, 215, 220], waterFill: [95, 145, 160],
    thread: [225, 228, 225], threadWarm: [245, 210, 155],
    grass: [150, 185, 125], straw: [225, 200, 140],
    rain: [200, 218, 230], sand: [235, 222, 195], stone: [20, 24, 30, 0.45]
  },
  day: {
    a: 2.6, glow: [255, 230, 180, 0.6],
    water: [55, 105, 120], waterFill: [85, 140, 155],
    thread: [90, 95, 92], threadWarm: [150, 112, 55],
    grass: [80, 112, 62], straw: [150, 124, 68],
    rain: [75, 98, 115], sand: [125, 102, 70], stone: [95, 85, 70, 0.28]
  }
};

let W = 0, H = 0, dpr = 1;
let name = 'water';
let P = PALETTES.night;
let t = 0, last = 0;
let breath = 0.5;          // 0 = empty lungs, 1 = full
let target = null;         // null = idle (slow drift on its own)
let speed = 1;             // how fast breath moves toward target
let state = {};
let glowMul = 1;          // the Glow slider (0.4–1.6)

const rgba = (c, alpha) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.min(1, alpha * P.a * glowMul)})`;

export function setGlow(g) { glowMul = g || 1; draw(); }

export function setScene(n) {
  name = SCENES.includes(n) ? n : 'water';
  document.body.dataset.scene = name;
  init();
}

export function setTheme(theme) {
  P = PALETTES[theme] || PALETTES.night;
  draw();
}

// inhaling: true / false, seconds: length of the phase. Pass null to go idle.
export function setBreath(inhaling, seconds = 3) {
  target = inhaling === null ? null : inhaling ? 1 : 0;
  speed = 3 / Math.max(0.5, seconds);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  init();
}

function init() {
  state = {};
  if (name === 'wind') initWind();
  if (name === 'grass') initGrass();
  if (name === 'rain') initRain();
  if (name === 'sand') initSand();
  draw();
}

function glow(x, y, r) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${P.glow[0]}, ${P.glow[1]}, ${P.glow[2]}, ${Math.min(1, P.glow[3] * glowMul)})`);
  g.addColorStop(1, `rgba(${P.glow[0]}, ${P.glow[1]}, ${P.glow[2]}, 0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------- water: layered swells ----------
function drawWater() {
  const scale = H / 800;
  glow(W * 0.7, H * 0.12, H * 0.6);
  const lines = 10;
  for (let i = 0; i < lines; i++) {
    const depth = i / (lines - 1);
    const y0 = H * (0.38 + depth * 0.58);
    const amp = (5 + depth * 16) * scale * (0.85 + 0.5 * breath);
    const k1 = 0.006 - depth * 0.003, k2 = 0.013 - depth * 0.006;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 8) {
      const y = y0 + amp * (0.65 * Math.sin(x * k1 + t * (0.22 + depth * 0.1) + i * 1.3)
        + 0.35 * Math.sin(x * k2 - t * (0.31 + depth * 0.05) + i * 2.1));
      x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(P.water, 0.05 + depth * 0.09);
    ctx.lineWidth = 1 + depth * 0.6;
    ctx.stroke();
    ctx.lineTo(W + 10, H); ctx.lineTo(-10, H); ctx.closePath();
    ctx.fillStyle = rgba(P.waterFill, 0.018 + depth * 0.012);
    ctx.fill();
  }
}

// ---------- wind: drifting threads of air ----------
function initWind() {
  const n = Math.round(Math.min(80, Math.max(35, (W * H) / 9000)));
  state.ps = Array.from({ length: n }, () => newThread(true));
}
function newThread(anywhere) {
  return {
    x: anywhere ? Math.random() * W : -40 - Math.random() * 200,
    y: Math.random() * H,
    v: 0.5 + Math.random() * 0.8,
    hist: [],
    tone: Math.random()
  };
}
function windAt(x, y) {
  return 22 * Math.sin(x * 0.0035 + t * 0.25 + y * 0.004) + 12 * Math.sin(y * 0.009 - t * 0.18 + x * 0.001);
}
function stepWind(dt) {
  const gust = 0.8 + 0.6 * breath;
  for (const p of state.ps) {
    p.x += p.v * 55 * gust * dt;
    p.y += windAt(p.x, p.y) * dt;
    p.hist.push(p.x, p.y);
    if (p.hist.length > 70) p.hist.splice(0, 2);
    if (p.x > W + 60) Object.assign(p, newThread(false));
  }
}
function drawWind() {
  ctx.lineCap = 'round';
  for (const p of state.ps) {
    const h = p.hist;
    if (h.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(h[0], h[1]);
    for (let i = 2; i < h.length; i += 2) ctx.lineTo(h[i], h[i + 1]);
    const a = 0.06 + 0.1 * p.tone;
    ctx.strokeStyle = rgba(p.tone > 0.75 ? P.threadWarm : P.thread, a);
    ctx.lineWidth = 0.8 + p.tone * 0.9;
    ctx.stroke();
  }
}

// ---------- grass: blades swaying in passing gusts ----------
function initGrass() {
  const n = Math.round(Math.min(220, W / 2.2));
  state.blades = Array.from({ length: n }, () => {
    const far = Math.random();
    return {
      x: Math.random() * (W + 40) - 20,
      h: H * (0.08 + (1 - far) * 0.3) * (0.7 + Math.random() * 0.5),
      w: 1 + (1 - far) * 2.2,
      far,
      ph: Math.random() * Math.PI * 2,
      tone: Math.random()
    };
  }).sort((a, b) => b.far - a.far);
}
function drawGrass() {
  glow(W * 0.3, H * 0.15, H * 0.55);
  const strength = 0.26 + 0.26 * breath;
  for (const b of state.blades) {
    const gust = 0.6 * Math.sin(b.x * 0.004 - t * 0.55) + 0.25 * Math.sin(b.x * 0.013 - t * 1.05 + b.ph) + 0.25;
    const lean = strength * gust * (1.2 - b.far * 0.5);
    const tipX = b.x + lean * b.h;
    const tipY = H - b.h * (1 - 0.18 * Math.abs(lean));
    const cx = b.x + lean * b.h * 0.35, cy = H - b.h * 0.55;
    ctx.beginPath();
    ctx.moveTo(b.x - b.w, H);
    ctx.quadraticCurveTo(cx, cy, tipX, tipY);
    ctx.quadraticCurveTo(cx + b.w * 0.6, cy, b.x + b.w, H);
    ctx.closePath();
    ctx.fillStyle = rgba(b.tone > 0.8 ? P.straw : P.grass, 0.08 + (1 - b.far) * 0.16);
    ctx.fill();
  }
}

// ---------- rain: fine slanted streaks, rings on the ground ----------
function initRain() {
  const n = Math.round(Math.min(150, Math.max(50, (W * H) / 5000)));
  state.drops = Array.from({ length: n }, () => newDrop(true));
  state.rings = [];
}
function newDrop(anywhere) {
  const near = Math.random();
  return {
    x: Math.random() * (W + 100) - 50,
    y: anywhere ? Math.random() * H : -40 - Math.random() * H * 0.3,
    len: 10 + near * 22,
    v: 260 + near * 260,
    near,
    stop: H * (0.7 + Math.random() * 0.3)
  };
}
function stepRain(dt) {
  const pace = 0.75 + 0.35 * (1 - breath);       // softer, slower rain on the in-breath
  for (const d of state.drops) {
    d.y += d.v * pace * dt;
    d.x += d.v * pace * dt * 0.12;
    if (d.y > d.stop) {
      if (d.near > 0.45 && state.rings.length < 40) state.rings.push({ x: d.x, y: d.stop, r: 0, life: 1 });
      Object.assign(d, newDrop(false));
    }
  }
  for (const r of state.rings) { r.r += dt * 22; r.life -= dt * 0.7; }
  state.rings = state.rings.filter(r => r.life > 0);
}
function drawRain() {
  glow(W * 0.5, -H * 0.1, H * 0.8);
  ctx.lineCap = 'round';
  for (const d of state.drops) {
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - d.len * 0.12, d.y - d.len);
    ctx.strokeStyle = rgba(P.rain, 0.05 + d.near * 0.1);
    ctx.lineWidth = 0.6 + d.near * 0.6;
    ctx.stroke();
  }
  for (const r of state.rings) {
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.r, r.r * 0.28, 0, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(P.rain, 0.14 * r.life);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

// ---------- sand: a raked garden around a few stones ----------
function initSand() {
  const u = Math.min(W, H * 0.8);
  state.stones = [
    { x: W * 0.3, y: H * 0.6, r: u * 0.075 },
    { x: W * 0.74, y: H * 0.78, r: u * 0.05 },
    { x: W * 0.62, y: H * 0.44, r: u * 0.032 }
  ];
  for (const s of state.stones) s.zone = s.r * 2.6;
}
const FLAT = 0.42;                                  // garden seen at an angle: circles become ellipses
function insideZone(x, y) {
  for (const s of state.stones) {
    const dx = x - s.x, dy = (y - s.y) / FLAT;
    if (dx * dx + dy * dy < s.zone * s.zone) return true;
  }
  return false;
}
function drawSand() {
  glow(W * 0.75, H * 0.1, H * 0.6);
  const top = H * 0.3, gap = Math.max(9, H / 70);
  const wobble = 1.4 + 1.2 * breath;
  ctx.lineWidth = 1;
  // raked lines, broken where they meet a stone's rings
  for (let y0 = top, i = 0; y0 < H + gap; y0 += gap, i++) {
    const fade = Math.min(1, (y0 - top) / (H * 0.2));
    ctx.beginPath();
    let pen = false;
    for (let x = -10; x <= W + 10; x += 6) {
      const y = y0 + wobble * Math.sin(x * 0.012 + t * 0.15 + i * 0.6);
      if (insideZone(x, y0)) { pen = false; continue; }
      pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      pen = true;
    }
    ctx.strokeStyle = rgba(P.sand, 0.07 * fade + 0.02);
    ctx.stroke();
  }
  // rings around each stone, then the stone
  for (const s of state.stones) {
    for (let r = s.r * 1.35; r <= s.zone; r += gap * 0.9) {
      const rr = r + wobble * 0.6 * Math.sin(t * 0.2 + r * 0.05);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, rr, rr * FLAT, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(P.sand, 0.08);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - s.r * 0.15, s.r, s.r * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${P.stone[0]}, ${P.stone[1]}, ${P.stone[2]}, ${P.stone[3]})`;
    ctx.fill();
  }
}

// ---------- loop ----------
function draw() {
  ctx.clearRect(0, 0, W, H);
  if (name === 'water') drawWater();
  else if (name === 'wind') drawWind();
  else if (name === 'grass') drawGrass();
  else if (name === 'rain') drawRain();
  else if (name === 'sand') drawSand();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (name === 'light' || document.hidden) { last = now; return; }
  if (now - last < 33) return;                 // ~30 fps is plenty for slow motion
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  t += dt;
  const goal = target === null ? 0.5 + 0.35 * Math.sin(t * 0.35) : target;
  breath += (goal - breath) * Math.min(1, dt * (target === null ? 2 : speed));
  if (name === 'wind') stepWind(dt);
  if (name === 'rain') stepRain(dt);
  draw();
}

window.addEventListener('resize', resize);
resize();
if (reduced) {
  // Still picture, no motion.
  if (name === 'wind') for (let i = 0; i < 120; i++) { t += 0.05; stepWind(0.05); }
  draw();
} else {
  requestAnimationFrame(frame);
}
