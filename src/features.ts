// Converts MediaPipe hand landmarks into a pose descriptor that is invariant
// to where the hand is in frame, how big it appears, and how it is rotated,
// so the classifier only sees the *shape* of the hand (i.e. the chord grip).

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

type Vec3 = [number, number, number];

const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

function sub(a: Landmark | Vec3, b: Landmark | Vec3): Vec3 {
  const [ax, ay, az] = toVec(a);
  const [bx, by, bz] = toVec(b);
  return [ax - bx, ay - by, az - bz];
}

function toVec(a: Landmark | Vec3): Vec3 {
  return Array.isArray(a) ? a : [a.x, a.y, a.z];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * Build a 60-dim feature vector (20 landmarks x 3 coords, wrist excluded)
 * expressed in a hand-local coordinate frame:
 *  - origin at the wrist
 *  - e1 along wrist -> middle finger MCP (the "up the palm" axis)
 *  - e2 across the knuckles (index MCP -> pinky MCP, orthogonalized)
 *  - e3 = e1 x e2 (out of the palm)
 * All coordinates are scaled by the wrist->middle-MCP distance.
 */
export function extractFeatures(landmarks: Landmark[]): number[] | null {
  if (landmarks.length < 21) return null;

  const wrist = landmarks[WRIST];
  const up = sub(landmarks[MIDDLE_MCP], wrist);
  const across = sub(landmarks[PINKY_MCP], landmarks[INDEX_MCP]);

  const scale = norm(up);
  if (scale < 1e-6) return null;

  const e1 = normalize(up);
  const acrossProj = sub(across, [
    dot(across, e1) * e1[0],
    dot(across, e1) * e1[1],
    dot(across, e1) * e1[2],
  ] as Vec3);
  if (norm(acrossProj) < 1e-6) return null;
  const e2 = normalize(acrossProj);
  const e3 = cross(e1, e2);

  const features: number[] = [];
  for (let i = 1; i < 21; i++) {
    const p = sub(landmarks[i], wrist);
    features.push(dot(p, e1) / scale, dot(p, e2) / scale, dot(p, e3) / scale);
  }
  return features;
}

export function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
