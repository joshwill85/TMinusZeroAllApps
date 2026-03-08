import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bearingDegrees, normalizeAngleDelta } from '@/lib/ar/geo';
import { azElFromEnu, ecefFromLatLon, enuFromEcef } from '@/lib/ar/ecef';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? null;
  const w = idx - lo;
  return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function readNumber(obj: unknown, key: string) {
  if (!obj || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[key];
  return isFiniteNumber(v) ? v : null;
}

function usage() {
  console.log('Usage: ts-node -r tsconfig-paths/register scripts/ar-trace-replay.ts <trace.json>');
}

const inputPath = process.argv[2];
if (!inputPath) {
  usage();
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), inputPath);
const rawText = fs.readFileSync(absPath, 'utf8');
const payload = JSON.parse(rawText) as Record<string, unknown>;

assert.equal(payload.schemaVersion, 1, 'unexpected schemaVersion');
assert(Array.isArray(payload.samples), 'trace payload missing samples[]');

const samples = payload.samples as Array<Record<string, unknown>>;
if (samples.length < 2) {
  console.log(`Trace has ${samples.length} sample(s). Need at least 2.`);
  process.exit(0);
}

const launch = (payload.launchName || payload.launchId) as string | undefined;
console.log(`Trace: ${launch ?? 'unknown launch'} (${samples.length} samples)`);

const t0 = readNumber(samples[0], 'tMs');
const tN = readNumber(samples[samples.length - 1], 'tMs');
if (t0 != null && tN != null && tN > t0) {
  console.log(`Duration: ${((tN - t0) / 1000).toFixed(1)}s`);
}

const yawErrors: number[] = [];
const yawOffsets: number[] = [];
const padBearings: number[] = [];
const adjustedHeadings: number[] = [];

for (const s of samples) {
  const computed = (s.computed && typeof s.computed === 'object' ? s.computed : null) as Record<string, unknown> | null;
  if (!computed) continue;
  const yawError = readNumber(computed, 'yawErrorDeg');
  const yawOffset = readNumber(computed, 'yawOffsetDeg');
  const padBearing = readNumber(computed, 'padBearingDeg');
  const adjustedHeading = readNumber(computed, 'adjustedHeadingDeg');

  if (yawError != null) yawErrors.push(yawError);
  if (yawOffset != null) yawOffsets.push(yawOffset);
  if (padBearing != null) padBearings.push(padBearing);
  if (adjustedHeading != null) adjustedHeadings.push(adjustedHeading);
}

const yawAbs = yawErrors.map((v) => Math.abs(v));
if (yawAbs.length) {
  console.log(
    `Yaw error |mean|=${(mean(yawAbs) ?? 0).toFixed(1)}° p50=${(percentile(yawAbs, 0.5) ?? 0).toFixed(
      1
    )}° p95=${(percentile(yawAbs, 0.95) ?? 0).toFixed(1)}° max=${Math.max(...yawAbs).toFixed(1)}°`
  );
}
if (yawOffsets.length) {
  const p50 = percentile(yawOffsets, 0.5);
  const p95 = percentile(yawOffsets.map((v) => Math.abs(v)), 0.95);
  console.log(`Yaw offset p50=${(p50 ?? 0).toFixed(1)}° p95(|.|)=${(p95 ?? 0).toFixed(1)}°`);
}

// Compare recorded pad bearing with a bearing derived from recorded lat/lon and pad coordinates.
const padMeta = (payload.pad && typeof payload.pad === 'object' ? payload.pad : null) as Record<string, unknown> | null;
const padLat = padMeta ? readNumber(padMeta, 'latitude') : null;
const padLon = padMeta ? readNumber(padMeta, 'longitude') : null;

let refBearingDelta: number[] = [];
if (padLat != null && padLon != null) {
  for (const s of samples) {
    const loc = (s.location && typeof s.location === 'object' ? s.location : null) as Record<string, unknown> | null;
    if (!loc) continue;
    const lat = readNumber(loc, 'lat');
    const lon = readNumber(loc, 'lon');
    const recordedPadBearing = readNumber((s.computed as any) ?? null, 'padBearingDeg');
    if (lat == null || lon == null || recordedPadBearing == null) continue;
    const ref = bearingDegrees(lat, lon, padLat, padLon);
    refBearingDelta.push(normalizeAngleDelta(recordedPadBearing - ref));
  }
}

if (refBearingDelta.length) {
  const abs = refBearingDelta.map((v) => Math.abs(v));
  console.log(
    `Pad bearing delta (recorded - derived) |mean|=${(mean(abs) ?? 0).toFixed(2)}° p95=${(percentile(abs, 0.95) ?? 0).toFixed(
      2
    )}° max=${Math.max(...abs).toFixed(2)}°`
  );
}

// Spot large discontinuities that are not explained by time gaps.
let discontinuities = 0;
for (let i = 1; i < samples.length; i += 1) {
  const a = samples[i - 1]!;
  const b = samples[i]!;
  const tA = readNumber(a, 'tMs');
  const tB = readNumber(b, 'tMs');
  if (tA == null || tB == null) continue;
  const dt = tB - tA;
  if (!(dt > 0 && dt < 750)) continue;

  const yawA = readNumber((a.computed as any) ?? null, 'yawErrorDeg');
  const yawB = readNumber((b.computed as any) ?? null, 'yawErrorDeg');
  if (yawA == null || yawB == null) continue;
  const dyaw = Math.abs(normalizeAngleDelta(yawB - yawA));
  if (dyaw > 25) discontinuities += 1;
}

if (discontinuities) {
  console.log(`Discontinuities: ${discontinuities} jumps >25° within <750ms`);
}

// Optional: estimate horizontal range for the first location sample.
if (padLat != null && padLon != null) {
  const firstLoc = samples.find((s) => {
    const loc = (s.location && typeof s.location === 'object' ? s.location : null) as Record<string, unknown> | null;
    return loc && readNumber(loc, 'lat') != null && readNumber(loc, 'lon') != null;
  });
  const loc = firstLoc?.location && typeof firstLoc.location === 'object' ? (firstLoc.location as Record<string, unknown>) : null;
  const lat = loc ? readNumber(loc, 'lat') : null;
  const lon = loc ? readNumber(loc, 'lon') : null;
  if (lat != null && lon != null) {
    const userEcef = ecefFromLatLon(lat, lon, 0);
    const padEcef = ecefFromLatLon(padLat, padLon, 0);
    const enu = enuFromEcef(lat, lon, userEcef, padEcef);
    const horizKm = Math.sqrt(enu[0] * enu[0] + enu[1] * enu[1]) / 1000;
    const azDeg = azElFromEnu(enu).azDeg;
    console.log(`Derived (from first loc): range≈${horizKm.toFixed(1)} km bearing≈${azDeg.toFixed(1)}°`);
  }
}

console.log('Replay complete.');

