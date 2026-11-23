// Runs a session script (see sessions/*.json) step by step.
// Fixed steps take their own time; steps marked "fill" share whatever
// time is left so the session ends close to the chosen duration.
// The plan is recomputed at every fill step, so it self-corrects when
// speech runs faster or slower than estimated.

import { speakOne, stopSpeech, splitSentences, estimate } from './speech.js';
import { bell, breathCue } from './audio.js';
import { getChapter } from './store.js';

const BELL_SECONDS = 5;
const NUMBERS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve'];

class Stopped extends Error {}

export class Player {
  constructor(script, { minutes, speed = 1, onUpdate = () => {} }) {
    this.script = script;
    this.total = minutes * 60;
    this.speed = speed;            // >1 only for testing (?fast=10)
    this.onUpdate = onUpdate;
    this.paused = false;
    this.stopped = false;
    this.active = 0;               // seconds of non-paused time
    this.lastTick = null;
    this.tao = new Map();          // chapter -> { lines per stanza } preloaded
    this.resumeWaiters = [];
  }

  // ---------- time ----------
  tick() {
    const now = performance.now();
    if (this.lastTick !== null && !this.paused) this.active += ((now - this.lastTick) / 1000) * this.speed;
    this.lastTick = now;
  }
  elapsed() { this.tick(); return this.active; }

  async wait(seconds) {
    let left = seconds;
    while (left > 0) {
      this.check();
      if (this.paused) { await this.untilResumed(); continue; }
      const chunk = Math.min(left, 0.25);
      await new Promise(r => setTimeout(r, (chunk * 1000) / this.speed));
      if (!this.paused) left -= chunk;
    }
    this.check();
  }

  check() { if (this.stopped) throw new Stopped(); }
  untilResumed() { return new Promise(r => this.resumeWaiters.push(r)); }

  pause() { this.tick(); this.paused = true; stopSpeech(); this.emit({}); }
  resume() {
    this.tick(); this.paused = false;
    this.resumeWaiters.splice(0).forEach(r => r());
    this.emit({});
  }
  stop() { this.stopped = true; stopSpeech(); this.resumeWaiters.splice(0).forEach(r => r()); }

  emit(state) {
    this.onUpdate({ ...state, paused: this.paused, elapsed: this.elapsed(), total: this.total });
  }

  // ---------- speech ----------
  async say(text, label = null) {
    for (const sentence of splitSentences(text)) {
      for (;;) {
        this.check();
        if (this.paused) { await this.untilResumed(); continue; }
        if (label !== null) this.emit({ phase: 'speak', label });
        if (this.speed > 1) await this.wait(estimate(sentence));
        else await speakOne(sentence);
        if (this.paused) continue;   // interrupted: repeat this sentence after resume
        break;
      }
    }
  }

  // ---------- planning ----------
  async preloadTao() {
    for (const s of this.script.steps) {
      if (s.type !== 'tao' || this.tao.has(s.chapter)) continue;
      const ch = await getChapter(s.chapter).catch(() => null);
      this.tao.set(s.chapter, ch || null);
    }
  }

  taoLines(step) {
    const ch = this.tao.get(step.chapter);
    if (!ch) return [];
    const wanted = step.stanzas || ch.stanzas.map((_, i) => i + 1);
    return wanted.flatMap(i => ch.stanzas[i - 1] || []);
  }

  fixedSeconds(step) {
    switch (step.type) {
      case 'speak': return estimate(step.text);
      case 'pause': return step.fill ? 0 : step.seconds || 0;
      case 'bell': return (step.strikes || 1) * BELL_SECONDS;
      case 'tao': {
        const lines = this.taoLines(step);
        return lines.reduce((t, l) => t + estimate(l), 0) + lines.length * (step.lineGap ?? 1);
      }
      case 'breath': return step.fill ? this.minBreath(step) : step.seconds || 0;
      default: return 0;
    }
  }

  cycle(step) { return step.pattern.inhale + (step.pattern.hold || 0) + step.pattern.exhale; }
  minBreath(step) {
    return step.count && step.count.voiced === 'first-round' ? step.count.to * this.cycle(step) : 0;
  }

  allocate(index) {
    const step = this.script.steps[index];
    const after = this.script.steps.slice(index + 1);
    const fixedAfter = after.reduce((t, s) => t + this.fixedSeconds(s), 0);
    const weights = [step, ...after].reduce((t, s) => t + (s.fill || 0), 0);
    const free = Math.max(0, this.total - this.elapsed() - fixedAfter);
    const share = (free * step.fill) / weights;
    return Math.max(share, this.minBreath(step));
  }

  // ---------- steps ----------
  async run() {
    await this.preloadTao();
    this.lastTick = performance.now();
    try {
      const steps = this.script.steps;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.type === 'speak') await this.say(s.text, '');
        else if (s.type === 'pause') {
          this.emit({ phase: 'rest', label: '' });
          await this.wait(s.fill ? this.allocate(i) : s.seconds);
        } else if (s.type === 'bell') {
          for (let k = 0; k < (s.strikes || 1); k++) {
            this.emit({ phase: 'bell', label: '' });
            bell();
            await this.wait(k < s.strikes - 1 ? 2.5 : BELL_SECONDS);
          }
        } else if (s.type === 'tao') await this.runTao(s);
        else if (s.type === 'breath') await this.runBreath(s, s.fill ? this.allocate(i) : s.seconds);
      }
      this.emit({ phase: 'done', label: '' });
    } catch (e) {
      if (!(e instanceof Stopped)) throw e;
    } finally {
      stopSpeech();
    }
  }

  async runTao(step) {
    const lines = this.taoLines(step);
    if (!lines.length) return;           // book not loaded: skip quietly
    for (const line of lines) {
      await this.say(line, '');
      this.emit({ phase: 'tao', label: '' });
      await this.wait(step.lineGap ?? 1);
    }
  }

  async runBreath(step, seconds) {
    const { inhale, hold = 0, exhale } = step.pattern;
    const breaths = Math.max(1, Math.round(seconds / this.cycle(step)));
    const to = step.count?.to || 10;
    const voiced = step.count?.voiced || 'none';
    for (let b = 0; b < breaths; b++) {
      const n = (b % to) + 1;
      this.emit({ phase: 'inhale', label: 'in', seconds: inhale / this.speed });
      breathCue('inhale', inhale / this.speed);
      await this.wait(inhale);
      if (hold) { this.emit({ phase: 'hold', label: '' }); await this.wait(hold); }
      this.emit({ phase: 'exhale', label: String(n), seconds: exhale / this.speed });
      breathCue('exhale', exhale / this.speed);
      const speakCount = voiced === 'all' || (voiced === 'first-round' && b < to);
      if (speakCount && this.speed === 1) {
        const t0 = this.elapsed();
        await speakOne(NUMBERS[n - 1] || String(n));
        await this.wait(Math.max(0, exhale - (this.elapsed() - t0)));
      } else {
        await this.wait(exhale);
      }
    }
  }
}
