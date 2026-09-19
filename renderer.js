/*
 * BPM-driven animation renderer.
 *
 * Frame timing is the phase accumulator from audio_bpm/bpm_gif.py, so tempo
 * changes glide rather than jumping:
 *
 *     loopsPerSecond = (bpm / 60) * loopsPerBeat
 *     phase          = (phase + dt * loopsPerSecond) % 1
 *     frame          = floor(phase * frameCount)
 *
 * GIF frames are pulled apart with WebCodecs ImageDecoder, which means an
 * uploaded GIF works with no build step — unlike the Twitch extension, which
 * needs make_spritesheet.py because browsers cannot rate-control a GIF.
 */

const LOOPS_PER_BEAT = 0.5;
const DEFAULT_BPM = 120;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frames = [];
    this.phase = 0;
    this.lastTick = null;
    this.bpm = null;
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  /** Decode every frame of an animated GIF into ImageBitmaps. */
  async loadGif(blob) {
    if (typeof ImageDecoder === 'undefined') {
      throw new Error('ImageDecoder unavailable — needs a Chromium browser.');
    }
    const decoder = new ImageDecoder({
      data: await blob.arrayBuffer(),
      type: blob.type || 'image/gif',
    });
    // tracks.ready must settle before selectedTrack exists; completed then
    // guarantees frameCount is final rather than still growing as it decodes.
    await decoder.tracks.ready;
    await decoder.completed;

    const track = decoder.tracks.selectedTrack;
    const frames = [];
    for (let i = 0; i < track.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      frames.push(await createImageBitmap(image));
      image.close();
    }
    this.frames = frames;
    return frames.length;
  }

  start() {
    const step = (timestampMs) => {
      requestAnimationFrame(step);
      this._draw(timestampMs / 1000);
    };
    requestAnimationFrame(step);
  }

  _draw(nowSec) {
    const dt = this.lastTick === null ? 0 : nowSec - this.lastTick;
    this.lastTick = nowSec;

    const bpm = this.bpm ?? DEFAULT_BPM;
    this.phase = (this.phase + dt * (bpm / 60) * LOOPS_PER_BEAT) % 1;

    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    if (this.frames.length > 0) {
      const index = Math.min(this.frames.length - 1, Math.floor(this.phase * this.frames.length));
      const frame = this.frames[index];
      const scale = Math.min(width / frame.width, height / frame.height);
      // Emotes are small: a 112px source blown up to fill the canvas turns to
      // mush under the default bilinear filter. Past ~2x magnification keep the
      // pixels crisp instead; larger sources still scale smoothly.
      this.ctx.imageSmoothingEnabled = scale < 2;
      const w = frame.width * scale;
      const h = frame.height * scale;
      this.ctx.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h);
    } else {
      this._drawPulse(width, height);
    }
  }

  /** Fallback so the render path is demonstrable even with no GIF loaded. */
  _drawPulse(width, height) {
    // Triangle wave on phase — peaks on the beat, so it reads as a pulse.
    const swell = 1 - Math.abs(this.phase * 2 - 1);
    const radius = Math.min(width, height) * (0.22 + 0.13 * swell);
    this.ctx.beginPath();
    this.ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(255, 214, 10, ${0.45 + 0.4 * swell})`;
    this.ctx.fill();
  }
}
