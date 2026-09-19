# BPM Dancing Emote

An emote that dances in time with whatever you're listening to.

Open the page, share the audio from a browser tab — a stream, a video, anything
playing music — and the animation speeds up and slows down to match the tempo it
hears. Everything runs in your browser. No account, no install, and the audio
never leaves your machine.

## Try it

1. Open the page.
2. Click **Capture tab audio**.
3. In the picker Chrome shows you, choose the **Chrome Tab** option at the top,
   pick the tab that's playing music, and tick **"Also share tab audio"** in the
   bottom-left corner.
4. Click **Share**.

The first tempo reading takes about four seconds, then updates once a second.

**Use your own emote** with the Animation picker, and **Reset to default** puts
the original back. Animated GIF, WebP, APNG and AVIF all work.

Video files (WebM, MP4) do **not** — frames are pulled apart with the browser's
`ImageDecoder`, which handles image formats only and rejects video containers.

## Requirements

- **A Chromium browser** — Chrome, Edge, Brave, Opera. Tab audio capture and
  in-browser GIF frame decoding aren't available in Firefox or Safari.
- **A tab that's actually playing audio.** The picker's "Window" option can't
  share audio at all; "Entire Screen" can share system audio on Windows, but
  that picks up notifications too.

## Running it yourself

It's a static page, but it can't be opened straight from disk — browsers block
JavaScript modules on `file://` URLs. Serve the folder over HTTP:

```bash
python -m http.server 8123 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8123/index.html>.

Any static host works too, as long as it serves the page over HTTPS at the top
level. It will **not** work embedded in a cross-origin iframe: browsers block
screen and tab capture there unless the embedding page explicitly allows it.

## How it works

```
tab audio ──> 4-second rolling window ──> tempo detection ──> smoothing ──> animation
```

Audio is tapped from the captured stream through an `AudioWorklet` and collected
into a four-second rolling window. Every second that window is analysed, using
DSP primitives from [libsonare](https://github.com/libraz/libsonare): first an
onset envelope — where energy rises, roughly where notes start — and then a
tempogram, which scores every plausible beat period against that envelope, for
every frame of the window.

That per-frame detail is the point. Tempo detectors frequently report half or
double the real tempo, and a single number per window gives you no way to tell a
good reading from an octave error. Instead each frame contributes its own
strongest tempo, anything outside 45–200 BPM is discarded, and the window's
reading is the **median** of what remains. A handful of frames latching onto
half speed get outvoted by the rest rather than becoming the answer.

How much of the window agreed with that median becomes the reading's confidence;
weak ones are dropped rather than smoothed in. What survives is averaged
exponentially and drives the animation through a phase accumulator:

```
loopsPerSecond = (bpm / 60) * loopsPerBeat
phase          = (phase + dt * loopsPerSecond) % 1
frame          = floor(phase * frameCount)
```

Driving the frame index from an accumulated phase rather than jumping to a new
frame rate means tempo changes glide instead of stuttering.

| File | Purpose |
| --- | --- |
| `index.html` | The page |
| `libsonare.html` | Same page running the alternative engine (below) |
| `main.js` | Wiring and smoothing |
| `capture.js` | Tab capture and the rolling window |
| `pcm-worklet.js` | Audio tap |
| `detector-tempogram.js` | Tempo detection |
| `detector-libsonare.js` | Alternative tempo detection (below) |
| `tempo-tracker.js` | Confidence gating, smoothing, octave handling for the alternative engine |
| `renderer.js` | GIF decoding and frame timing |

### Alternative engine

`libsonare.html` is the same page using libsonare's own BPM aggregation rather
than its raw primitives. That returns one estimate per window plus a ranked list
of candidate tempos, so octave errors are handled differently: instead of
outvoting them within a window, each candidate is scored on its own confidence
and on how closely it continues the tempo established so far, measured against
the median of recent readings. A median anchor matters there — a running average
gets dragged toward outliers, so a couple of half-speed readings would pull the
reference halfway to the wrong answer and the error would reinforce itself.

It is faster (roughly 40 ms per window against 85 ms) but noisier on expressive
playing, where its per-window estimate can swing considerably. Which engine
suits a given kind of music is genuinely unsettled, which is why both are here.
The pages are otherwise identical; `libsonare.html` is marked as such in its
footer.

## Credits and licence

This code is MIT licensed — see [LICENSE](LICENSE).

Audio analysis by [libsonare](https://github.com/libraz/libsonare), Apache-2.0,
loaded from jsDelivr at runtime. Both engines rely on it — the default for its
onset and tempogram primitives, the alternative for its BPM estimation too.

No third-party artwork ships with this repository. The default animation is
Twitch's DinoDance emote, fetched at runtime from Twitch's own CDN and never
copied here; it remains the property of Twitch Interactive, Inc. If that CDN is
unreachable the page falls back to a plain pulsing shape, and you can load any
animation of your own with the picker.
