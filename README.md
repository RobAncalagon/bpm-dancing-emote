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
into a four-second rolling window. Every second that window is passed to
[libsonare](https://github.com/libraz/libsonare), which returns a tempo estimate
along with a confidence score and a ranked list of candidate tempos.

Those candidates are what make the reading stable. Tempo detectors frequently
report half or double the real tempo, so rather than trusting the headline
number, each candidate is scored on its own confidence and on how well it
continues the tempo established so far. The anchor for that comparison is the
*median* of recent readings rather than a running average — an average gets
dragged toward outliers, so a couple of half-speed readings would pull it
halfway to the wrong answer and the error would reinforce itself. A median
ignores a minority of bad readings outright.

The chosen value is then smoothed with an exponential moving average and drives
the animation through a phase accumulator:

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
| `tempo-tracker.js` | Octave resolution and smoothing |
| `renderer.js` | GIF decoding and frame timing |

### How tempo is estimated

The default builds an onset envelope, derives a tempogram from it, takes the
dominant tempo of each frame, discards anything outside 45–200 BPM and returns
the median. Filtering a distribution this way is more resistant to half and
double-speed errors than trusting any single estimate.

### Alternative engine

`libsonare.html` is the same page driven by libsonare's own BPM aggregation
instead, which returns one estimate per window along with ranked candidate
tempos that get scored for consistency with the tempo so far.

Which engine suits a given kind of music is genuinely unsettled, which is why
both are here. The pages are otherwise identical; `libsonare.html` is marked as
such in its footer.

## Credits and licence

This code is MIT licensed — see [LICENSE](LICENSE).

Tempo detection by [libsonare](https://github.com/libraz/libsonare), Apache-2.0,
loaded from jsDelivr at runtime.

No third-party artwork ships with this repository. The default animation is
Twitch's DinoDance emote, fetched at runtime from Twitch's own CDN and never
copied here; it remains the property of Twitch Interactive, Inc. If that CDN is
unreachable the page falls back to a plain pulsing shape, and you can load any
animation of your own with the picker.
