import { config } from 'dotenv';
import { execFile } from 'node:child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { promisify } from 'util';
import { fetchSpaceXLaunchTiles, fetchSpaceXMission } from '@/lib/ingestion/spacexWebsite';

config({ path: '.env.local' });
config();

type Args = {
  limit: number;
  missionIds: string[];
  prefer: 'desktop' | 'mobile';
  saveArtifacts: boolean;
  outDir: string | null;
  maxImageBytes: number;
  engine: 'auto' | 'docker' | 'tesseractjs';
  upcomingOnly: boolean;
  missionTypes: string[];
  maxMissionLookups: number;
};

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const missionArg = args.find((a) => a.startsWith('--mission-id=') || a.startsWith('--mission-ids='));
  const preferArg = args.find((a) => a.startsWith('--prefer='));
  const outDirArg = args.find((a) => a.startsWith('--out-dir='));
  const engineArg = args.find((a) => a.startsWith('--engine='));
  const upcomingArg = args.find((a) => a === '--upcoming-only' || a === '--all');
  const missionTypeArg = args.find((a) => a.startsWith('--mission-type=') || a.startsWith('--mission-types='));
  const maxLookupsArg = args.find((a) => a.startsWith('--max-lookups='));

  const missionIds = (missionArg ? missionArg.split('=')[1] : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const preferRaw = (preferArg ? preferArg.split('=')[1] : '').trim().toLowerCase();
  const prefer: Args['prefer'] = preferRaw === 'mobile' ? 'mobile' : 'desktop';

  const outDir = outDirArg ? outDirArg.split('=')[1].trim() : null;

  const engineRaw = (engineArg ? engineArg.split('=')[1] : '').trim().toLowerCase();
  const engine = engineRaw === 'docker' || engineRaw === 'tesseractjs' ? (engineRaw as Args['engine']) : 'auto';

  const missionTypes = (missionTypeArg ? missionTypeArg.split('=')[1] : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const maxMissionLookupsRaw = maxLookupsArg ? Number(maxLookupsArg.split('=')[1]) : NaN;
  const maxMissionLookups = Number.isFinite(maxMissionLookupsRaw) ? Math.max(10, Math.min(2000, Math.trunc(maxMissionLookupsRaw))) : 200;

  return {
    limit: limitArg ? Math.max(1, Math.min(50, Number(limitArg.split('=')[1]))) : 10,
    missionIds,
    prefer,
    saveArtifacts: args.includes('--save') || args.includes('--save-artifacts'),
    outDir: outDir || null,
    maxImageBytes: 15 * 1024 * 1024,
    engine,
    upcomingOnly: upcomingArg === '--all' ? false : true,
    missionTypes,
    maxMissionLookups
  };
}

type OcrParse = {
  orbit_class: string | null;
  inclination_deg: number | null;
  altitude_km: number | null;
  apogee_km: number | null;
  perigee_km: number | null;
  score: number;
  reasons: string[];
};

function parseOrbitFromOcrText(textRaw: string): OcrParse {
  const text = (textRaw || '').replace(/\s+/g, ' ').trim();
  const reasons: string[] = [];

  const orbitClassMatch = text.match(/\b(SSO|Sun-?synchronous|GTO|GEO|LEO|ISS|Polar)\b/i);
  const orbit_class = orbitClassMatch ? orbitClassMatch[1] : null;
  if (orbit_class) reasons.push(`orbit_class=${orbit_class}`);

  const inclinationKeywordMatch =
    text.match(/inclination[^0-9]{0,25}([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:deg|degrees|°)/i) ??
    text.match(/\bincl\.?[^0-9]{0,25}([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:deg|degrees|°)/i);
  let inclination_deg = inclinationKeywordMatch ? Number(inclinationKeywordMatch[1]) : null;
  let inclinationHeuristic = false;
  if (inclination_deg == null || !Number.isFinite(inclination_deg)) {
    const degMatches = Array.from(text.matchAll(/([0-9]{1,3}(?:\.[0-9]+)?)\s*°/g)).map((m) => Number(m[1]));
    const plausible = degMatches.filter((n) => Number.isFinite(n) && n >= 0 && n <= 180);
    if (plausible.length) {
      // Heuristic: pick the first plausible degrees-with-symbol number.
      inclination_deg = plausible[0];
      inclinationHeuristic = true;
    }
  }
  if (inclination_deg != null && Number.isFinite(inclination_deg)) {
    reasons.push(`inclination=${inclination_deg}${inclinationHeuristic ? '(heuristic)' : ''}`);
  }

  const altitudeKeywordMatch =
    text.match(/altitude[^0-9]{0,25}([0-9]{2,5}(?:\.[0-9]+)?)\s*(km|kilometers)\b/i) ??
    text.match(/\borbit[^0-9]{0,25}([0-9]{2,5}(?:\.[0-9]+)?)\s*(km|kilometers)\b/i);
  let altitude_km = altitudeKeywordMatch ? Number(altitudeKeywordMatch[1]) : null;
  let altitudeHeuristic = false;
  if (altitude_km == null || !Number.isFinite(altitude_km)) {
    const kmMatches = Array.from(text.matchAll(/([0-9]{2,6}(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:km|kilometers)\b/gi)).map((m) =>
      Number(String(m[1]).replace(/,/g, ''))
    );
    const plausible = kmMatches.filter((n) => Number.isFinite(n) && n >= 80 && n <= 500_000);
    if (plausible.length) {
      altitude_km = plausible[0];
      altitudeHeuristic = true;
    }
  }
  if (altitude_km != null && Number.isFinite(altitude_km)) {
    reasons.push(`altitude=${altitude_km}km${altitudeHeuristic ? '(heuristic)' : ''}`);
  }

  const apogeeMatch = text.match(/apogee[^0-9]{0,25}([0-9]{2,6}(?:\.[0-9]+)?)\s*(km|kilometers)\b/i);
  const perigeeMatch = text.match(/perigee[^0-9]{0,25}([0-9]{2,6}(?:\.[0-9]+)?)\s*(km|kilometers)\b/i);
  const apogee_km = apogeeMatch ? Number(apogeeMatch[1]) : null;
  const perigee_km = perigeeMatch ? Number(perigeeMatch[1]) : null;
  if (apogee_km != null && Number.isFinite(apogee_km)) reasons.push(`apogee=${apogee_km}km`);
  if (perigee_km != null && Number.isFinite(perigee_km)) reasons.push(`perigee=${perigee_km}km`);

  const inRange = (value: number, min: number, max: number) => value >= min && value <= max;

  let score = 0;
  if (orbit_class) score += 1;

  if (inclination_deg != null && Number.isFinite(inclination_deg)) {
    if (inRange(inclination_deg, 0, 180)) score += inclinationHeuristic ? 2 : 3;
    else score -= 2;
  }
  if (altitude_km != null && Number.isFinite(altitude_km)) {
    if (inRange(altitude_km, 80, 200_000)) score += altitudeHeuristic ? 1 : 2;
    else score -= 2;
  }
  if (apogee_km != null && Number.isFinite(apogee_km)) {
    if (inRange(apogee_km, 80, 500_000)) score += 1;
    else score -= 1;
  }
  if (perigee_km != null && Number.isFinite(perigee_km)) {
    if (inRange(perigee_km, 80, 500_000)) score += 1;
    else score -= 1;
  }

  if (!reasons.length) reasons.push('no_orbit_signal');
  return { orbit_class, inclination_deg, altitude_km, apogee_km, perigee_km, score, reasons };
}

async function fetchBytesWithLimit(url: string, maxBytes: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'image/*'
      }
    });
    if (!res.ok) throw new Error(`fetch_${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no_body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) throw new Error('image_too_large');
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function preprocessPng(inputBytes: Uint8Array, variant: 'hi_contrast' | 'threshold') {
  const img = sharp(inputBytes, { failOnError: false }).rotate();
  const meta = await img.metadata();

  const base = img
    .resize({
      width: meta.width && meta.width > 2200 ? meta.width : 2400,
      withoutEnlargement: false
    })
    .grayscale()
    .normalize()
    .sharpen();

  if (variant === 'threshold') {
    return await base.threshold(175).png().toBuffer();
  }
  return await base.png().toBuffer();
}

const execFileAsync = promisify(execFile);

async function hasDocker() {
  try {
    await execFileAsync('docker', ['version'], { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

const TESSERACT_IMAGE_TAG = 'tminusnow/tesseract:alpine';

async function ensureTesseractDockerImage() {
  try {
    await execFileAsync('docker', ['image', 'inspect', TESSERACT_IMAGE_TAG], { timeout: 8_000 });
    return { ok: true as const, built: false as const };
  } catch {
    // Not built yet.
  }

  const dockerfileDir = path.resolve('scripts/ocr/tesseract');
  await execFileAsync('docker', ['build', '-t', TESSERACT_IMAGE_TAG, dockerfileDir], {
    timeout: 10 * 60_000,
    maxBuffer: 10 * 1024 * 1024
  });
  return { ok: true as const, built: true as const };
}

async function ocrWithDockerTesseract({ pngPath, psm }: { pngPath: string; psm: number }): Promise<{ text: string; engine: 'docker' }> {
  const hostDir = path.dirname(pngPath);
  const fileName = path.basename(pngPath);
  const containerPath = `/data/${fileName}`;
  const { stdout } = await execFileAsync(
    'docker',
    ['run', '--rm', '-v', `${hostDir}:/data`, TESSERACT_IMAGE_TAG, containerPath, 'stdout', '-l', 'eng', '--psm', String(psm)],
    { timeout: 90_000, maxBuffer: 15 * 1024 * 1024 }
  );
  return { text: (stdout || '').trim(), engine: 'docker' };
}

async function main() {
  const args = parseArgs(process.argv);

  const dockerAvailable = await hasDocker();

  const tmpRoot = args.outDir
    ? path.resolve(args.outDir)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'spacex-infographic-ocr-'));
  if (args.saveArtifacts || args.outDir) await ensureDir(tmpRoot);

  const tiles = args.missionIds.length
    ? null
    : await fetchSpaceXLaunchTiles({ upcomingOnly: args.upcomingOnly }).catch(() => []);
  const filteredTiles = Array.isArray(tiles)
    ? tiles.filter((t) => {
        if (!t?.link) return false;
        if (!args.missionTypes.length) return true;
        const mt = typeof t.missionType === 'string' ? t.missionType.trim() : '';
        if (!mt) return false;
        return args.missionTypes.some((want) => want.toLowerCase() === mt.toLowerCase());
      })
    : null;

  const missionIds = args.missionIds.length
    ? args.missionIds
    : (filteredTiles ?? []).map((t) => t.link || '').filter(Boolean);

  if (!missionIds.length) {
    console.log('No mission IDs found.');
    return;
  }

  const selected = missionIds;

  let ocrEngine: 'docker' | 'tesseractjs' = 'docker';

  if (args.engine !== 'docker') {
    try {
      const mod = await import('tesseract.js');
      const { createWorker } = mod as any;
      const worker = await createWorker('eng');
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      ocrEngine = 'tesseractjs';

      const results: Array<Record<string, unknown>> = [];
      let processed = 0;
      let lookups = 0;
      for (const missionId of selected) {
        if (processed >= args.limit) break;
        if (lookups >= args.maxMissionLookups) break;
        lookups += 1;
        const res = await processMission({
          args,
          missionId,
          tmpRoot,
          ocr: async (png) => {
            const ocr = await worker.recognize(png);
            const text = typeof ocr?.data?.text === 'string' ? ocr.data.text : '';
            const confidence = typeof ocr?.data?.confidence === 'number' ? ocr.data.confidence : null;
            return { text, confidence, engine: 'tesseractjs' as const };
          }
        });
        if (!args.missionIds.length && !(res as any).ok && (res as any).error === 'no_infographic') continue;
        results.push(res);
        processed += 1;
      }

      await worker.terminate();
      await printSummary({ args, tmpRoot, results });
      return;
    } catch (err) {
      if (args.engine === 'tesseractjs') {
        console.error(`Failed to use tesseract.js: ${String(err)}`);
        process.exit(2);
      }
      // Fall back to Docker.
    }
  }

  if (!dockerAvailable) {
    console.error('No OCR engine available. Install `tesseract.js` under the repo\'s pinned toolchain or run with Docker available.');
    process.exit(2);
  }

  await ensureTesseractDockerImage();
  ocrEngine = 'docker';

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let lookups = 0;

  for (const missionId of selected) {
    if (processed >= args.limit) break;
    if (lookups >= args.maxMissionLookups) break;
    lookups += 1;

    const res = await processMission({
      args,
      missionId,
      tmpRoot,
      ocr: async (pngPath) => {
        const { text, engine } = await ocrWithDockerTesseract({ pngPath, psm: 6 });
        return { text, confidence: null, engine };
      }
    });
    if (!args.missionIds.length && !(res as any).ok && (res as any).error === 'no_infographic') continue;
    results.push(res);
    processed += 1;
  }

  await printSummary({ args, tmpRoot, results, ocrEngine });
}

async function processMission({
  args,
  missionId,
  tmpRoot,
  ocr
}: {
  args: Args;
  missionId: string;
  tmpRoot: string;
  ocr: (pngPath: string) => Promise<{ text: string; confidence: number | null; engine: 'docker' | 'tesseractjs' }>;
}): Promise<Record<string, unknown>> {
  const mission = await fetchSpaceXMission({ missionId }).catch(() => null);
  if (!mission) return { missionId, ok: false, error: 'mission_fetch_failed' };

  const desktop = mission.infographicDesktop?.url ?? null;
  const mobile = mission.infographicMobile?.url ?? null;
  const preferred = args.prefer === 'mobile' ? mobile || desktop : desktop || mobile;
  if (!preferred) return { missionId, title: mission.title, ok: false, error: 'no_infographic' };

  const startedAt = Date.now();
  let bytes: Uint8Array;
  try {
    bytes = await fetchBytesWithLimit(preferred, args.maxImageBytes);
  } catch (err) {
    return { missionId, title: mission.title, ok: false, error: String(err), url: preferred };
  }

  const meta = await sharp(bytes, { failOnError: false }).metadata().catch(() => null);

  const variants: Array<{ name: string; png: Buffer }> = [];
  try {
    variants.push({ name: 'hi_contrast', png: await preprocessPng(bytes, 'hi_contrast') });
    variants.push({ name: 'threshold', png: await preprocessPng(bytes, 'threshold') });
  } catch (err) {
    return { missionId, title: mission.title, ok: false, error: `preprocess_failed:${String(err)}`, url: preferred };
  }

  let best: { variant: string; text: string; confidence: number | null; parsed: OcrParse; engine: 'docker' | 'tesseractjs' } | null = null;

  for (const v of variants) {
    const fileBase = `${missionId.replace(/[^a-z0-9_-]+/gi, '_')}_${v.name}`;
    const pngPath = path.join(tmpRoot, `${fileBase}.png`);
    await fs.writeFile(pngPath, v.png);
    const { text, confidence, engine } = await ocr(pngPath);

    const parsed = parseOrbitFromOcrText(text);
    const pickScore = parsed.score + (typeof confidence === 'number' ? (confidence / 100) * 0.5 : 0);
    const bestScore =
      best == null
        ? -Infinity
        : best.parsed.score + (typeof best.confidence === 'number' ? (best.confidence / 100) * 0.5 : 0);
    if (!best || pickScore > bestScore) {
      best = { variant: v.name, text, confidence, parsed, engine };
    }

    if (!args.saveArtifacts && !args.outDir) {
      await fs.unlink(pngPath).catch(() => {});
    }
  }

  return {
    missionId,
    title: mission.title,
    ok: true,
    url: preferred,
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    elapsedMs: Date.now() - startedAt,
    bestVariant: best?.variant ?? null,
    ocrEngine: best?.engine ?? null,
    ocrConfidence: best?.confidence ?? null,
    parsed: best?.parsed ?? null,
    textPreview: best?.text ? best.text.slice(0, 500) : null
  };
}

async function printSummary({
  args,
  tmpRoot,
  results,
  ocrEngine
}: {
  args: Args;
  tmpRoot: string;
  results: Array<Record<string, unknown>>;
  ocrEngine?: 'docker' | 'tesseractjs';
}) {
  const withSignal = results.filter((r: any) => r.ok && (r.parsed?.score ?? 0) > 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        ocrEngine: ocrEngine ?? null,
        sampled: results.length,
        withOrbitSignal: withSignal.length,
        percentWithSignal: results.length ? Math.round((withSignal.length / results.length) * 100) : 0,
        artifactsDir: args.saveArtifacts || args.outDir ? tmpRoot : null,
        results
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
