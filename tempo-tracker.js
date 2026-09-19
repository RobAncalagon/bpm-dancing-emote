/*
 * Turns a stream of per-window tempo readings into one stable BPM.
 *
 * Two problems to solve, and they want different tools:
 *
 *   Octave errors — a detector reporting half or double the real tempo. These
 *   are large, sudden, and wrong. Handled by choosing among the detector's own
 *   candidate tempos, scoring each on its confidence and how well it continues
 *   the tempo established so far.
 *
 *   Jitter — small window-to-window wobble around the right answer. Handled by
 *   an exponential moving average.
 *
 * The reference used for octave decisions is the MEDIAN of recent readings, not
 * the EMA. An EMA is dragged toward outliers, so a couple of half-speed
 * readings pull the reference halfway to the wrong octave and the error becomes
 * self-reinforcing. A median ignores a minority of bad readings entirely.
 */

// Matches BPM_MIN / BPM_MAX in cgbpm's audio_player_with_tempo.py.
export const BPM_MIN = 45;
export const BPM_MAX = 200;

// How strongly to prefer a candidate that continues the current tempo. Higher
// values track more stubbornly; low enough that a genuinely better-supported
// tempo still wins, so the tracker cannot lock onto a wrong octave forever.
const PROXIMITY_WEIGHT = 2.0;

// Readings below this are treated as no reading at all rather than being
// smoothed in. Deliberately low: on expressive playing, confidence is often
// modest even when the estimate is fine.
const MIN_CONFIDENCE = 0.1;

const HISTORY_SIZE = 8;
const EMA_ALPHA = 0.3;

/** Double or halve until the reading sits inside the plausible range. */
export function foldIntoRange(bpm, min = BPM_MIN, max = BPM_MAX) {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  let folded = bpm;
  while (folded < min) folded *= 2;
  while (folded > max) folded /= 2;
  return folded >= min && folded <= max ? folded : null;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Score a candidate tempo: its own support, discounted by how far it sits from
 * the tempo established so far. Distance is measured in log space, where an
 * octave up and an octave down count the same.
 */
function score(bpm, confidence, reference) {
  if (reference === null) return confidence;
  const distance = Math.abs(Math.log2(bpm / reference));
  return confidence / (1 + PROXIMITY_WEIGHT * distance);
}

export class TempoTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.history = [];
    this.smoothed = null;
  }

  /** Median of recent accepted readings — the anchor for octave decisions. */
  get reference() {
    return median(this.history);
  }

  /**
   * Fold a detector reading in.
   *
   * @param {{bpm: number, confidence: number,
   *          candidates?: Array<{bpm: number, confidence: number}>}} reading
   * @returns {number|null} the smoothed BPM, or null if the reading was unusable
   */
  update(reading) {
    if (!reading || reading.confidence < MIN_CONFIDENCE) return null;

    const reference = this.reference;

    // The detector's headline estimate competes with its own alternatives on
    // equal terms — it is frequently not the best continuation.
    const options = new Map();
    const consider = (bpm, confidence) => {
      const folded = foldIntoRange(bpm);
      if (folded === null) return;
      const key = folded.toFixed(1);
      const existing = options.get(key);
      if (!existing || confidence > existing.confidence) {
        options.set(key, { bpm: folded, confidence });
      }
    };

    consider(reading.bpm, reading.confidence);
    for (const candidate of reading.candidates ?? []) {
      consider(candidate.bpm, candidate.confidence);
    }
    if (options.size === 0) return null;

    let best = null;
    let bestScore = -Infinity;
    for (const option of options.values()) {
      const optionScore = score(option.bpm, option.confidence, reference);
      if (optionScore > bestScore) {
        bestScore = optionScore;
        best = option.bpm;
      }
    }

    this.history.push(best);
    if (this.history.length > HISTORY_SIZE) this.history.shift();

    this.smoothed = this.smoothed === null
      ? best
      : EMA_ALPHA * best + (1 - EMA_ALPHA) * this.smoothed;
    return this.smoothed;
  }
}
