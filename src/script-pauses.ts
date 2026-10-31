import type {PauseSpec} from "./dsl/types.js";
import {pause as pauseHelper} from "./dsl/pause.js";
import {CompileError} from "./errors.js";

export function normalizePauseSpec(value: PauseSpec | number | undefined | null): PauseSpec | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return pauseHelper(value);
  }
  return value;
}

export function samplePause(spec: PauseSpec, rng: () => number): number {
  if (spec.mode === "fixed") {
    if (!Number.isFinite(spec.seconds)) throw new CompileError("Pause must be finite");
    return Math.max(0, spec.seconds);
  }
  if (!Number.isFinite(spec.mean) || !Number.isFinite(spec.std) || spec.std < 0 ||
      (spec.min != null && !Number.isFinite(spec.min)) || (spec.max != null && !Number.isFinite(spec.max)) ||
      (spec.min != null && spec.max != null && spec.min > spec.max)) throw new CompileError("Invalid Gaussian pause");
  let val = gaussianSample(rng, spec.mean, spec.std);
  if (spec.min != null) {
    val = Math.max(val, spec.min);
  }
  if (spec.max != null) {
    val = Math.min(val, spec.max);
  }
  return Math.max(0, val);
}

function gaussianSample(rng: () => number, mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

export function makeRng(seed: number | null): () => number {
  if (seed == null) {
    return () => Math.random();
  }
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}


