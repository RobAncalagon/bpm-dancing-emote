/*
 * Wiring: capture → sliding window → detector → octave guard → EMA → renderer.
 *
 * The detector sits behind a small interface so it can be swapped without
 * touching anything either side of analyse():
 *
 *   { name, async init(sampleRate),
 *     async analyse(Float32Array, sampleRate) -> { bpm, confidence } | null }
 */

import { Capture, SlidingWindow, SAMPLE_RATE } from './capture.js';
import { Renderer } from './renderer.js';
import { libsonareDetector } from './detector-libsonare.js';
import { tempogramDetector } from './detector-tempogram.js';
import { TempoTracker } from './tempo-tracker.js';

// Which engine runs is chosen by the page, via <body data-detector="...">, so
// both pages can share this file. Both detectors import the same libsonare
// module URL, so loading both costs one request either way.
const DETECTORS = {
  tempogram: tempogramDetector,
  libsonare: libsonareDetector,
};

const detector = DETECTORS[document.body.dataset.detector] ?? tempogramDetector;

const WINDOW_SEC = 4.0;   // seconds of audio per analysis window
const HOP_SEC = 1.0;      // how often a new reading is produced

// Loaded from Twitch's own CDN rather than bundled, so the emote is never
// redistributed by this project. Their CDN sends access-control-allow-origin: *,
// which is what makes fetching the bytes for frame decoding possible at all.
// If it is unreachable the renderer falls back to a pulsing shape.
const DEFAULT_GIF = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/default/dark/3.0';

const ui = {
  status: document.getElementById('status'),
  bpm: document.getElementById('bpm'),
  tabButton: document.getElementById('start-tab'),
  gifInput: document.getElementById('gif-input'),
  resetButton: document.getElementById('reset-gif'),
  canvas: document.getElementById('stage'),
};

const renderer = new Renderer(ui.canvas);
renderer.start();

const tracker = new TempoTracker();

let capture = null;
let analysing = false;
let firstReading = true;

function setStatus(text, tone = '') {
  ui.status.textContent = text;
  ui.status.dataset.tone = tone;
}

function onReading(reading) {
  const bpm = tracker.update(reading);
  if (bpm === null) return; // too weak to use, or outside any plausible range

  renderer.setBpm(bpm);
  ui.bpm.textContent = bpm.toFixed(1);

  if (firstReading) {
    firstReading = false;
    setStatus('Listening to the shared tab.', 'live');
  }
}

async function start() {
  if (capture) capture.stop();
  tracker.reset();
  firstReading = true;
  ui.bpm.textContent = '—';

  setStatus('Starting up …');
  try {
    await detector.init(SAMPLE_RATE);
  } catch (e) {
    setStatus(`Could not load the tempo detector: ${e.message}`, 'error');
    return;
  }

  const windower = new SlidingWindow(SAMPLE_RATE, WINDOW_SEC, HOP_SEC);

  const onSharingStopped = () => {
    capture?.stop();
    capture = null;
    setStatus('Sharing stopped. Click "Capture tab audio" to start again.');
  };

  capture = new Capture(async (chunk) => {
    for (const window of windower.push(chunk)) {
      // Skip a window rather than queue work up if analysis is still running.
      if (analysing) continue;
      analysing = true;
      try {
        const result = detector.analyse(window, SAMPLE_RATE);
        if (result) onReading(result);
      } catch {
        // A single bad window is not worth interrupting playback for.
      } finally {
        analysing = false;
      }
    }
  }, onSharingStopped);

  try {
    await capture.startTabCapture();
    setStatus(`Listening — first reading in about ${WINDOW_SEC} seconds.`, 'live');
  } catch (e) {
    setStatus(e.message, 'error');
    capture = null;
  }
}

async function loadDefaultGif() {
  try {
    const response = await fetch(DEFAULT_GIF);
    if (!response.ok) throw new Error(String(response.status));
    await renderer.loadGif(await response.blob());
  } catch {
    // Renderer falls back to a pulsing shape if no frames are available.
  }
}

ui.tabButton.addEventListener('click', start);

ui.gifInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await renderer.loadGif(file);
  } catch (e) {
    setStatus(`Could not read that image: ${e.message}`, 'error');
  }
});

ui.resetButton.addEventListener('click', () => {
  ui.gifInput.value = ''; // let the same file be re-picked after a reset
  loadDefaultGif();
});

loadDefaultGif();
