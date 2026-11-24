// Sessions built on the fly: the journey through the 81 chapters, and the
// silent timer. Same script format as sessions/*.json (see README).

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty'];

export function numberWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
}

export const JOURNEY_DURATIONS = [5, 10, 15];

// One chapter, read whole, with room around it. The intro and the words after
// the reading change from day to day (pools.json).
export function journeyScript(chapter) {
  return {
    id: 'journey',
    title: `Chapter ${chapter}`,
    closing: 'none',                 // the chapter itself is the reading: no extra passage
    durations: JOURNEY_DURATIONS,
    steps: [
      { type: 'bell', strikes: 1 },
      { type: 'pause', seconds: 3 },
      { type: 'speak', pool: 'journey-intro' },
      { type: 'pause', fill: 1 },
      { type: 'speak', text: `Chapter ${numberWords(chapter)}.` },
      { type: 'pause', seconds: 3 },
      { type: 'tao', chapter, lineGap: 2, stanzaGap: 4 },
      { type: 'pause', seconds: 8 },
      { type: 'speak', pool: 'journey-after' },
      { type: 'pause', fill: 4 },
      { type: 'bell', strikes: 2 }
    ]
  };
}

export const TIMER_DURATIONS = [5, 10, 15, 20, 30, 45];
export const TIMER_INTERVALS = [0, 2, 5, 10];        // minutes between bells; 0 = none

// Silence with a bell at the start, one every `every` minutes, three at the end.
export function timerScript(minutes, every) {
  const steps = [{ type: 'bell', strikes: 1 }];
  const BELL = 5;                                      // seconds a bell takes (player.js)
  if (every && every < minutes) {
    const bells = Math.ceil(minutes / every) - 1;
    for (let k = 0; k < bells; k++) {
      steps.push({ type: 'pause', seconds: every * 60 - BELL }, { type: 'bell', strikes: 1 });
    }
  }
  steps.push({ type: 'pause', fill: 1 }, { type: 'bell', strikes: 3 });
  return { id: 'timer', title: 'Silent timer', steps };
}
