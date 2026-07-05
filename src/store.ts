import { ChordClassifier } from "./classifier";

const KEY = "rechord-training-v1";
const SETTINGS_KEY = "rechord-settings-v1";

export interface Settings {
  frettingHand: "Left" | "Right";
}

export function loadClassifier(): ChordClassifier {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return ChordClassifier.fromJSON(JSON.parse(raw));
  } catch {
    // Corrupt data — start fresh rather than crash.
  }
  return new ChordClassifier();
}

export function saveClassifier(c: ChordClassifier): void {
  localStorage.setItem(KEY, JSON.stringify(c.toJSON()));
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      if (s.frettingHand === "Left" || s.frettingHand === "Right") {
        return { frettingHand: s.frettingHand };
      }
    }
  } catch {
    // fall through to default
  }
  return { frettingHand: "Left" };
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
