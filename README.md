# rechord 🎸

Point your webcam at your fretting hand and **rechord** tells you what guitar
chord you're playing — entirely in the browser, no server, no data leaves your
machine.

## How it works

1. **Hand tracking** — [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
   runs locally in the browser (WebAssembly + GPU) and tracks 21 3D landmarks
   on each hand in real time.
2. **Pose normalization** — the landmarks of your fretting hand are converted
   into a hand-local coordinate frame (origin at the wrist, axes aligned to
   the palm, scaled by hand size), so the descriptor captures the *shape* of
   your grip regardless of where the hand is, how far from the camera, or how
   it's rotated.
3. **Classification** — a distance-weighted k-nearest-neighbor classifier
   compares your live hand shape against samples *you* record, with temporal
   smoothing so the readout doesn't flicker. Think Teachable Machine, but for
   chord grips.

Training on your own hands takes about a minute and makes recognition far more
reliable than any pre-baked model could be — everyone's hands and fretting
style differ.

## Getting started

```bash
npm install
npm run dev
```

Open the printed URL (Chrome/Edge/Firefox, desktop or mobile), allow camera
access, and:

1. Pick your **fretting hand** (left for right-handed players).
2. Sit so your fretting hand is clearly visible — palm/knuckles roughly facing
   the camera works best.
3. Select a chord, hold the shape on the neck, press **● Record**. It captures
   30 samples over ~1–2 seconds. Do 2–3 recordings per chord from slightly
   different angles.
4. Repeat for each chord you want recognized. The live readout appears in the
   bottom-left of the video as soon as you have samples.
5. Optional: hit **Start practice** and rechord will call out chords for you
   to hit.

Training data is saved in `localStorage` and can be exported/imported as JSON
(handy for moving between devices).

## Honest limitations

- **It reads hand shape, not the fretboard.** Two chords with the same grip at
  different frets (e.g. an E-shape barre at fret 1 vs fret 3) look identical
  to it. Name them by shape ("F barre", "G barre") or keep to open chords.
- It needs a clear view of your fretting hand — heavy occlusion by the neck at
  extreme angles will drop tracking.
- If it highlights the wrong hand (green skeleton on your strumming hand),
  flip the fretting-hand toggle.

## Roadmap ideas

- Fretboard detection (locate nut/frets/strings) to disambiguate position and
  infer actual notes rather than learned shapes.
- Audio fusion: confirm the chord with microphone-based chroma analysis.
- Finger-placement feedback ("your ring finger is muting the B string").
- Shareable/community training sets.

## Stack

- [Vite](https://vite.dev) + TypeScript, zero framework
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision)
  for hand landmark detection (wasm + model fetched from CDN on first load,
  then cached)
