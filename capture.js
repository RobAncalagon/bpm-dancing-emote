/*
 * Audio capture and windowing.
 *
 * Captured audio feeds a PCM tap worklet whose output is routed through a muted
 * gain node: the audio graph only pulls a node that reaches the destination, but
 * replaying the captured audio would double what the listener already hears.
 *
 * SlidingWindow keeps a rolling analysis buffer and emits it every hop.
 */

// libsonare's librosa-derived defaults assume 44.1 kHz. Forcing the context rate
// lets the browser resample the captured stream instead of doing it by hand.
export const SAMPLE_RATE = 44100;

export class SlidingWindow {
  constructor(sampleRate, windowSec, hopSec) {
    this.windowSize = Math.round(sampleRate * windowSec);
    this.hopSize = Math.round(sampleRate * hopSec);
    this.buffer = new Float32Array(0);
    this.sinceLastEmit = 0;
  }

  /** Append a chunk; returns whole analysis windows that are now ready. */
  push(chunk) {
    const merged = new Float32Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    this.sinceLastEmit += chunk.length;

    const windows = [];
    while (this.buffer.length >= this.windowSize && this.sinceLastEmit >= this.hopSize) {
      windows.push(this.buffer.slice(this.buffer.length - this.windowSize));
      this.sinceLastEmit -= this.hopSize;
    }

    if (this.buffer.length > this.windowSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.windowSize);
    }
    return windows;
  }
}

export class Capture {
  constructor(onChunk, onEnded) {
    this.onChunk = onChunk;
    this.onEnded = onEnded;
    this.context = null;
    this.stream = null;
  }

  /** Capture another tab's audio. Chromium only, and needs a user gesture. */
  async startTabCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen capture unavailable — this needs a Chromium browser.');
    }

    // video:true is mandatory: Chrome only offers the "share tab audio" checkbox
    // for a tab pick, and rejects audio-only requests outright.
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    if (this.stream.getAudioTracks().length === 0) {
      this.stop();
      throw new Error('No audio was shared — pick a tab and tick "Also share tab audio".');
    }
    this.stream.getVideoTracks().forEach((track) => track.stop()); // discard the pixels

    // Chrome's "Stop sharing" bar ends the track without telling the page
    // otherwise — audio would just silently stop arriving.
    this.stream.getAudioTracks()[0].addEventListener('ended', () => this.onEnded?.());

    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.context.audioWorklet.addModule('pcm-worklet.js');

    const source = this.context.createMediaStreamSource(this.stream);
    const tap = new AudioWorkletNode(this.context, 'pcm-tap');
    tap.port.onmessage = (event) => this.onChunk(event.data);

    const mute = this.context.createGain();
    mute.gain.value = 0;

    source.connect(tap);
    tap.connect(mute);
    mute.connect(this.context.destination);

    await this.context.resume();
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close();
    this.stream = null;
    this.context = null;
  }
}
