// Abstract nature backgrounds drawn on a canvas: water, wind, grass.
// During a session the scene follows the breath (see setBreath).
// Kept light for phones: ~30 fps, capped pixel ratio, nothing drawn when hidden.

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let W = 0, H = 0, dpr = 1;
let name = 'water';
let t = 0, last = 0;
let breath = 0.5;          // 0 = empty lungs, 1 = full
let target = null;         // null = idle (slow drift on its own)
let speed = 1;             // how fast breath moves toward target
let state = {};

export const SCENES = ['water', 'wind', 'grass', 'light'];

export function setScene(n) {
  name = SCENES.includes(n) ? n : 'water';
  document.body.dataset.scene = name;
  init();
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
  draw();
}

// ---------- water: layered swells ----------
function drawWater() {
  const scale = H / 800;
  const glow = ctx.createRadialGradient(W * 0.7, H * 0.12, 0, W * 0.7, H * 0.12, H * 0.6);
  glow.addColorStop(0, 'rgba(200, 190, 150, 0.07)');
  glow.addColorStop(1, 'rgba(200, 190, 150, 0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  const lines = 10;
  for (let i = 0; i < lines; i++) {
    const depth = i / (lines - 1);
    const y0 = H * (0.38 + depth * 0.58);
    const amp = (5 + depth * 16) * scale * (0.6 + 0.8 * breath);
    const k1 = 0.006 - depth * 0.003, k2 = 0.013 - depth * 0.006;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 8) {
      const y = y0 + amp * (0.65 * Math.sin(x * k1 + t * (0.22 + depth * 0.1) + i * 1.3)
        + 0.35 * Math.sin(x * k2 - t * (0.31 + depth * 0.05) + i * 2.1));
      x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(150, 195, 195, ${0.05 + depth * 0.09})`;
    ctx.lineWidth = 1 + depth * 0.6;
    ctx.stroke();
    ctx.lineTo(W + 10, H); ctx.lineTo(-10, H); ctx.closePath();
    ctx.fillStyle = `rgba(60, 110, 120, ${0.018 + depth * 0.012})`;
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
  const gust = 0.55 + 0.9 * breath;
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
    ctx.strokeStyle = p.tone > 0.75 ? `rgba(215, 190, 140, ${a})` : `rgba(200, 205, 195, ${a})`;
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
  const mist = ctx.createLinearGradient(0, H * 0.45, 0, H);
  mist.addColorStop(0, 'rgba(120, 140, 100, 0)');
  mist.addColorStop(1, 'rgba(120, 140, 100, 0.06)');
  ctx.fillStyle = mist; ctx.fillRect(0, H * 0.45, W, H * 0.55);

  const strength = 0.18 + 0.32 * breath;
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
    const a = 0.08 + (1 - b.far) * 0.16;
    ctx.fillStyle = b.tone > 0.8 ? `rgba(190, 170, 110, ${a})` : `rgba(120, 150, 100, ${a})`;
    ctx.fill();
  }
}

// ---------- loop ----------
function draw() {
  ctx.clearRect(0, 0, W, H);
  if (name === 'water') drawWater();
  else if (name === 'wind') drawWind();
  else if (name === 'grass') drawGrass();
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
