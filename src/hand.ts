import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./features";

// Both the wasm runtime and the model are served locally (see
// scripts/copy-wasm.mjs and public/models/), so the app works offline and the
// wasm always matches the installed @mediapipe/tasks-vision version.
// BASE_URL keeps the paths correct when hosted under a subpath (GitHub Pages).
const WASM_URL = `${import.meta.env.BASE_URL}wasm`;
const MODEL_URL = `${import.meta.env.BASE_URL}models/hand_landmarker.task`;

export interface TrackedHand {
  /** Normalized image-space landmarks (0..1), used for drawing. */
  landmarks: Landmark[];
  /** Metric world-space landmarks, used for classification. */
  worldLandmarks: Landmark[];
  /** "Left" | "Right" as reported by MediaPipe. */
  handedness: string;
}

export class HandTracker {
  private constructor(private landmarker: HandLandmarker) {}

  static async create(): Promise<HandTracker> {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return new HandTracker(landmarker);
  }

  detect(video: HTMLVideoElement, timestampMs: number): TrackedHand[] {
    const result = this.landmarker.detectForVideo(video, timestampMs);
    const hands: TrackedHand[] = [];
    for (let i = 0; i < result.landmarks.length; i++) {
      hands.push({
        landmarks: result.landmarks[i],
        worldLandmarks: result.worldLandmarks[i],
        handedness: result.handedness[i]?.[0]?.categoryName ?? "Unknown",
      });
    }
    return hands;
  }
}

// Landmark index pairs forming the hand skeleton, for the overlay drawing.
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm edge
];
