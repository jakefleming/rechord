import { distance } from "./features";

export interface Prediction {
  label: string;
  confidence: number; // 0..1
}

interface Sample {
  label: string;
  features: number[];
}

const K = 7;

/**
 * Distance-weighted k-nearest-neighbor classifier over hand-pose feature
 * vectors, with a temporal smoother so the displayed chord doesn't flicker
 * between frames.
 */
export class ChordClassifier {
  private samples: Sample[] = [];
  private history: string[] = [];
  private readonly historySize = 12;

  get labels(): string[] {
    return [...new Set(this.samples.map((s) => s.label))];
  }

  sampleCount(label: string): number {
    return this.samples.reduce((n, s) => n + (s.label === label ? 1 : 0), 0);
  }

  get trainedLabels(): string[] {
    return this.labels.filter((l) => this.sampleCount(l) >= 10);
  }

  add(label: string, features: number[]): void {
    this.samples.push({ label, features });
  }

  remove(label: string): void {
    this.samples = this.samples.filter((s) => s.label !== label);
  }

  clear(): void {
    this.samples = [];
    this.history = [];
  }

  get isEmpty(): boolean {
    return this.samples.length === 0;
  }

  /** Raw single-frame prediction. */
  predict(features: number[]): Prediction | null {
    if (this.samples.length === 0) return null;

    const scored = this.samples
      .map((s) => ({ label: s.label, d: distance(features, s.features) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.min(K, this.samples.length));

    // Weight each neighbor by inverse distance so close matches dominate.
    const votes = new Map<string, number>();
    let total = 0;
    for (const { label, d } of scored) {
      const w = 1 / (d + 1e-6);
      votes.set(label, (votes.get(label) ?? 0) + w);
      total += w;
    }

    let best: Prediction = { label: "", confidence: 0 };
    for (const [label, w] of votes) {
      const confidence = w / total;
      if (confidence > best.confidence) best = { label, confidence };
    }

    // Penalize matches that are absolutely far from anything we trained on.
    // In normalized hand units a held chord jitters ~0.1-0.3 from its own
    // samples, while genuinely different grips sit ~1.0+ apart, so fade
    // confidence out toward that boundary.
    const nearest = scored[0].d;
    const proximity = Math.max(0, 1 - nearest / 1.0);
    best.confidence *= proximity;
    return best;
  }

  /** Prediction smoothed over the last few frames. */
  predictSmoothed(features: number[]): Prediction | null {
    const raw = this.predict(features);
    if (!raw) return null;

    this.history.push(raw.confidence >= 0.4 ? raw.label : "");
    if (this.history.length > this.historySize) this.history.shift();

    const counts = new Map<string, number>();
    for (const l of this.history) counts.set(l, (counts.get(l) ?? 0) + 1);

    let bestLabel = "";
    let bestCount = 0;
    for (const [l, c] of counts) {
      if (c > bestCount) {
        bestLabel = l;
        bestCount = c;
      }
    }

    if (!bestLabel || bestCount < this.history.length * 0.6) return null;
    return { label: bestLabel, confidence: raw.label === bestLabel ? raw.confidence : 0.4 };
  }

  resetSmoothing(): void {
    this.history = [];
  }

  toJSON(): { version: number; samples: Sample[] } {
    return { version: 1, samples: this.samples };
  }

  static fromJSON(data: unknown): ChordClassifier {
    const c = new ChordClassifier();
    if (
      data &&
      typeof data === "object" &&
      Array.isArray((data as { samples?: unknown }).samples)
    ) {
      for (const s of (data as { samples: unknown[] }).samples) {
        const sample = s as Sample;
        if (
          typeof sample.label === "string" &&
          Array.isArray(sample.features) &&
          sample.features.length === 60 &&
          sample.features.every((f) => typeof f === "number")
        ) {
          c.add(sample.label, sample.features);
        }
      }
    }
    return c;
  }
}
