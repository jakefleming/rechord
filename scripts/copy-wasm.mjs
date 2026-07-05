// Copies the MediaPipe wasm runtime out of node_modules into public/ so the
// app serves it itself instead of hitting a CDN at runtime.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(root, "public", "wasm");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copied MediaPipe wasm -> ${dest}`);
