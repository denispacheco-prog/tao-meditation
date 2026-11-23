// Runs a session script (see sessions/*.json) step by step.
// Fixed steps take their own time; steps marked "fill" share whatever
// time is left so the session ends close to the chosen duration.
// The plan is recomputed at every fill step, so it self-corrects when
// speech runs faster or slower than estimated.

import { speakOne, stopSpeech, splitSentences, estimate } from './speech.js';
import { bell, breathCue } from './audio.js';
import { getChapter } from './store.js';
import { pickPassage, rememberChapters } from './tao.js';

const BELL_SECONDS = 5;
const NUMBERS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve'];

class Stopped extends Error {}

export class Player {
  constructor(script, { minutes, speed = 1, onUpdate = () => {} }) {
    this.script = script;
    this.total = minutes * 60;
    // Steps can be limited to some durations: "minMinutes" / "maxMinutes".
    this.steps = script.steps.filter(s =>
      (s.minMinutes === undefined || minutes >= s.minMinutes) &&
      (s.maxMinutes === undefined || minutes <= s.maxMinutes));
    this.speed = speed;            // >1 only for testing (?fast=10)
    this.onUpdate = onUpdate;
    this.paused = false;
    this.stopped = false;
    this.active = 0;               // seconds of non-paused time
    this.lastTick = null;
    this.tao = new Map();          // tao step -> lines to read (resolved before starting)
    this.chapters = [];            // chapters used in this session
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
  // A tao step is either fixed ({ chapter, stanzas? }) or drawn from a theme
  // ({ theme, maxLines? }), avoiding chapters read recently.
  async preloadTao() {
    for (const s of this.steps) {
      if (s.type !== 'tao') continue;
      let lines = [];
      if (s.theme) {
        const p = await pickPassage(s.theme, { maxLines: s.maxLines || 8, exclude: this.chapters, getChapter });
        if (p) { lines = p.lines; this.chapters.push(p.chapter); }
      } else {
        const ch = await getChapter(s.chapter).catch(() => null);
        if (ch) {
          const wanted = s.stanzas || ch.stanzas.map((_, i) => i + 1);
          lines = wanted.flatMap(i => ch.stanzas[i - 1] || []);
          this.chapters.push(s.chapter);
        }
      }
      this.tao.set(s, lines);
    }
    if (this.chapters.length) rememberChapters(this.chapters);
  }

  taoLines(step) { return this.tao.get(step) || []; }

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

  cycle(step) {
    const p = step.pattern;
    return p.inhale + (p.hold || 0) + p.exhale + (p.holdOut || 0);
  }
  minBreath(step) {
    if (step.count && step.count.voiced === 'first-round') return step.count.to * this.cycle(step);
    if (step.cues) return step.cues * this.cycle(step);
    return 0;
  }

  allocate(index) {
    const step = this.steps[index];
    const after = this.steps.slice(index + 1);
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
      const steps = this.steps;
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

  // One breath phase: optional spoken word, then wait out the rest of the phase.
  async phase(name, seconds, label, word) {
    if (!seconds) return;
    this.emit({ phase: name, label, seconds: seconds / this.speed });
    if (name === 'inhale' || name === 'exhale') breathCue(name, seconds / this.speed);
    if (word && this.speed === 1) {
      const t0 = this.elapsed();
      await speakOne(word);
      await this.wait(Math.max(0, seconds - (this.elapsed() - t0)));
    } else {
      await this.wait(seconds);
    }
  }

  // "count": count breaths on the exhale (voiced none / first-round / all).
  // "cues": speak "In / Hold / Out" for the first N breaths.
  async runBreath(step, seconds) {
    const { inhale, hold = 0, exhale, holdOut = 0 } = step.pattern;
    const breaths = Math.max(1, Math.round(seconds / this.cycle(step)));
    const to = step.count?.to || 10;
    const voiced = step.count?.voiced || 'none';
    const cues = step.cues || 0;
    for (let b = 0; b < breaths; b++) {
      const n = (b % to) + 1;
      const cue = b < cues;
      const speakCount = step.count && (voiced === 'all' || (voiced === 'first-round' && b < to));
      await this.phase('inhale', inhale, cue ? 'in' : '', cue && 'In');
      await this.phase('hold', hold, cue ? 'hold' : '', cue && 'Hold');
      await this.phase('exhale', exhale, step.count ? String(n) : cue ? 'out' : '',
        speakCount ? (NUMBERS[n - 1] || String(n)) : cue && 'Out');
      await this.phase('hold', holdOut, cue ? 'hold' : '', cue && 'Hold');
    }
    this.emit({ phase: 'rest', label: '' });
  }
}
