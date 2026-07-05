import "./style.css";
import { HandTracker, HAND_CONNECTIONS, type TrackedHand } from "./hand";
import { extractFeatures } from "./features";
import { ChordClassifier } from "./classifier";
import {
  loadClassifier,
  saveClassifier,
  loadSettings,
  saveSettings,
  type Settings,
} from "./store";

const DEFAULT_CHORDS = ["C", "A", "G", "E", "D", "Am", "Em", "Dm", "F", "B7"];
const SAMPLES_PER_RECORDING = 30;
const PRACTICE_HOLD_FRAMES = 15;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const loadingEl = $("loading");
const chordDisplay = $("chord-display");
const chordNameEl = $("chord-name");
const confidenceBar = $("confidence-bar");
const statusEl = $("status");
const chordSelect = $<HTMLSelectElement>("chord-select");
const recordBtn = $<HTMLButtonElement>("record");
const recordProgress = $("record-progress");
const recordProgressBar = $("record-progress-bar");
const sampleList = $("sample-list");
const practiceToggle = $<HTMLButtonElement>("practice-toggle");
const practiceBanner = $("practice-banner");
const practiceTarget = $("practice-target");
const practiceStatus = $("practice-status");

const classifier: ChordClassifier = loadClassifier();
const settings: Settings = loadSettings();
const customChords: string[] = [];

let recording: { label: string; captured: number } | null = null;
let practice: { target: string; heldFrames: number; celebrating: boolean } | null =
  null;

// ---------------------------------------------------------------------------
// UI wiring

function allChordNames(): string[] {
  return [...new Set([...DEFAULT_CHORDS, ...customChords, ...classifier.labels])];
}

function refreshChordSelect(): void {
  const current = chordSelect.value;
  chordSelect.innerHTML = "";
  for (const name of allChordNames()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    chordSelect.appendChild(opt);
  }
  if (current && allChordNames().includes(current)) chordSelect.value = current;
}

function refreshSampleList(): void {
  sampleList.innerHTML = "";
  for (const label of classifier.labels) {
    const li = document.createElement("li");
    const count = classifier.sampleCount(label);
    const trained = count >= 10;
    li.innerHTML = `<span class="sample-label">${label}</span>
      <span class="sample-count ${trained ? "ok" : "low"}">${count} samples</span>`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini danger";
    del.textContent = "✕";
    del.title = `Delete all ${label} samples`;
    del.addEventListener("click", () => {
      classifier.remove(label);
      saveClassifier(classifier);
      refreshSampleList();
    });
    li.appendChild(del);
    sampleList.appendChild(li);
  }
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function updateHandButtons(): void {
  $("hand-left").classList.toggle("active", settings.frettingHand === "Left");
  $("hand-right").classList.toggle("active", settings.frettingHand === "Right");
}

$("hand-left").addEventListener("click", () => {
  settings.frettingHand = "Left";
  saveSettings(settings);
  classifier.resetSmoothing();
  updateHandButtons();
});
$("hand-right").addEventListener("click", () => {
  settings.frettingHand = "Right";
  saveSettings(settings);
  classifier.resetSmoothing();
  updateHandButtons();
});

$("add-chord").addEventListener("click", () => {
  const name = prompt("Chord name (e.g. Cadd9, F#m, \"barre E shape fret 3\"):");
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!customChords.includes(trimmed)) customChords.push(trimmed);
  refreshChordSelect();
  chordSelect.value = trimmed;
});

recordBtn.addEventListener("click", () => {
  if (recording) return;
  recording = { label: chordSelect.value, captured: 0 };
  recordBtn.disabled = true;
  recordProgress.hidden = false;
  recordProgressBar.style.width = "0%";
  setStatus(`recording "${recording.label}" — hold the chord steady…`);
});

practiceToggle.addEventListener("click", () => {
  if (practice) {
    practice = null;
    practiceBanner.hidden = true;
    practiceToggle.textContent = "Start practice";
    return;
  }
  const pool = classifier.trainedLabels;
  if (pool.length < 2) {
    setStatus("train at least 2 chords (10+ samples each) to start practice");
    return;
  }
  practiceToggle.textContent = "Stop practice";
  nextPracticeTarget();
});

function nextPracticeTarget(): void {
  const pool = classifier.trainedLabels;
  let target = pool[Math.floor(Math.random() * pool.length)];
  if (practice && pool.length > 1) {
    while (target === practice.target) {
      target = pool[Math.floor(Math.random() * pool.length)];
    }
  }
  practice = { target, heldFrames: 0, celebrating: false };
  practiceBanner.hidden = false;
  practiceBanner.classList.remove("success");
  practiceTarget.textContent = target;
  practiceStatus.textContent = "";
}

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(classifier.toJSON(), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rechord-training.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("import").addEventListener("click", () => $<HTMLInputElement>("import-file").click());
$<HTMLInputElement>("import-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const imported = ChordClassifier.fromJSON(JSON.parse(await file.text()));
    for (const label of imported.labels) {
      classifier.remove(label);
    }
    for (const s of imported.toJSON().samples) {
      classifier.add(s.label, s.features);
    }
    saveClassifier(classifier);
    refreshChordSelect();
    refreshSampleList();
    setStatus(`imported training data (${imported.labels.join(", ")})`);
  } catch {
    setStatus("import failed — not a valid rechord training file");
  }
  (e.target as HTMLInputElement).value = "";
});

$("clear").addEventListener("click", () => {
  if (!confirm("Delete all trained chord samples?")) return;
  classifier.clear();
  saveClassifier(classifier);
  refreshSampleList();
});

// ---------------------------------------------------------------------------
// Camera + detection loop

function pickFrettingHand(hands: TrackedHand[]): TrackedHand | null {
  if (hands.length === 0) return null;
  // The overlay/video are mirrored for the user, and MediaPipe labels
  // handedness on the unmirrored frame — so the physical hand the user calls
  // "left" is reported as "Right". Flip the preference to compensate.
  const wanted = settings.frettingHand === "Left" ? "Right" : "Left";
  return hands.find((h) => h.handedness === wanted) ?? hands[0];
}

function drawOverlay(hands: TrackedHand[], fretting: TrackedHand | null): void {
  const ctx = overlay.getContext("2d");
  if (!ctx) return;
  if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.save();
  // Mirror the drawing to match the mirrored video element.
  ctx.translate(overlay.width, 0);
  ctx.scale(-1, 1);

  for (const hand of hands) {
    const isFretting = hand === fretting;
    ctx.strokeStyle = isFretting ? "#4ade80" : "rgba(255,255,255,0.25)";
    ctx.fillStyle = isFretting ? "#4ade80" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = isFretting ? 3 : 2;

    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = hand.landmarks[a];
      const pb = hand.landmarks[b];
      ctx.beginPath();
      ctx.moveTo(pa.x * overlay.width, pa.y * overlay.height);
      ctx.lineTo(pb.x * overlay.width, pb.y * overlay.height);
      ctx.stroke();
    }
    for (const p of hand.landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * overlay.width, p.y * overlay.height, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function handleRecording(features: number[] | null): void {
  if (!recording) return;
  if (!features) {
    setStatus(`recording "${recording.label}" — can't see your fretting hand`);
    return;
  }
  classifier.add(recording.label, features);
  recording.captured++;
  recordProgressBar.style.width = `${(recording.captured / SAMPLES_PER_RECORDING) * 100}%`;
  if (recording.captured >= SAMPLES_PER_RECORDING) {
    saveClassifier(classifier);
    setStatus(`saved ${SAMPLES_PER_RECORDING} samples of "${recording.label}"`);
    recording = null;
    recordBtn.disabled = false;
    recordProgress.hidden = true;
    refreshSampleList();
    refreshChordSelect();
    classifier.resetSmoothing();
  }
}

function handlePrediction(features: number[] | null): void {
  if (classifier.isEmpty) {
    chordDisplay.hidden = true;
    return;
  }
  chordDisplay.hidden = false;

  const prediction = features ? classifier.predictSmoothed(features) : null;
  if (!prediction) {
    chordNameEl.textContent = "—";
    confidenceBar.style.width = "0%";
    if (practice && !practice.celebrating) practice.heldFrames = 0;
    return;
  }

  chordNameEl.textContent = prediction.label;
  confidenceBar.style.width = `${Math.round(prediction.confidence * 100)}%`;

  if (practice && !practice.celebrating) {
    if (prediction.label === practice.target) {
      practice.heldFrames++;
      practiceStatus.textContent = "hold it…";
      if (practice.heldFrames >= PRACTICE_HOLD_FRAMES) {
        practice.celebrating = true;
        practiceBanner.classList.add("success");
        practiceStatus.textContent = "✓";
        setTimeout(() => {
          if (practice) nextPracticeTarget();
        }, 900);
      }
    } else {
      practice.heldFrames = 0;
      practiceStatus.textContent = "";
    }
  }
}

async function start(): Promise<void> {
  refreshChordSelect();
  refreshSampleList();
  updateHandButtons();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
  } catch {
    loadingEl.textContent = "camera access denied — rechord needs your webcam to see your hands";
    setStatus("camera unavailable");
    return;
  }
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  setStatus("loading hand tracking model…");
  let tracker: HandTracker;
  try {
    tracker = await HandTracker.create();
  } catch (err) {
    loadingEl.textContent = "failed to load the hand tracking model — check your connection and reload";
    setStatus(String(err));
    return;
  }
  loadingEl.hidden = true;

  let lastVideoTime = -1;
  const loop = (): void => {
    if (video.currentTime !== lastVideoTime && video.videoWidth > 0) {
      lastVideoTime = video.currentTime;
      const hands = tracker.detect(video, performance.now());
      const fretting = pickFrettingHand(hands);
      const features = fretting ? extractFeatures(fretting.worldLandmarks) : null;

      drawOverlay(hands, fretting);
      handleRecording(features);
      handlePrediction(features);

      if (!recording) {
        if (hands.length === 0) setStatus("no hands in view");
        else if (classifier.isEmpty)
          setStatus("tracking — record some chords to start recognizing");
        else setStatus("tracking");
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start();
