// WMM-2025 coefficients (NOAA/NCEI) packaged as JSON.
// Local copy source: geomagnetism (Apache-2.0) data/wmm-2025.json.
import wmm2025Raw from '@/lib/ar/wmm-2025.json';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const MAGNETIC_NORTH_POLE_2025 = { lat: 86.5, lon: 164.0 };
const MAX_DECLINATION_DEG = 40;
const WMM_REFERENCE_RADIUS_KM = 6371.2;
const WMM_A_KM = 6378.137;
const WMM_B_KM = 6356.7523142;
const WMM_EPS_SQ = 1 - (WMM_B_KM * WMM_B_KM) / (WMM_A_KM * WMM_A_KM);

type WmmModelData = {
  main_field_coeff_g: number[];
  main_field_coeff_h: number[];
  secular_var_coeff_g: number[];
  secular_var_coeff_h: number[];
  n_max: number;
  n_max_sec_var: number;
  epoch: number;
  start_date: string;
  end_date: string;
};

const WMM_2025 = wmm2025Raw as WmmModelData;

const WMM_VALID_START_MS = Date.parse(WMM_2025.start_date);
const WMM_VALID_END_MS = Date.parse(WMM_2025.end_date);

export type DeclinationSource = 'wmm' | 'approx' | 'none';

export type DeclinationResult = {
  declinationDeg: number;
  source: DeclinationSource;
};

export function bearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const phi1 = fromLat * DEG_TO_RAD;
  const phi2 = toLat * DEG_TO_RAD;
  const deltaLon = (toLon - fromLon) * DEG_TO_RAD;

  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  const theta = Math.atan2(y, x);
  const deg = (theta * RAD_TO_DEG + 360) % 360;
  return deg;
}

export function normalizeAngleDelta(delta: number) {
  const normalized = ((delta + 540) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

export function approximateMagneticDeclinationDeg(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  // Approximation: treat the geomagnetic north pole direction as "magnetic north".
  // This is not a full WMM implementation, but it removes the biggest systematic yaw bias in many regions.
  const bearingToPole = bearingDegrees(lat, lon, MAGNETIC_NORTH_POLE_2025.lat, MAGNETIC_NORTH_POLE_2025.lon);
  const declination = normalizeAngleDelta(bearingToPole);
  return Math.min(MAX_DECLINATION_DEG, Math.max(-MAX_DECLINATION_DEG, declination));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function decimalYear(date: Date) {
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const nextYearStart = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - yearStart) / (nextYearStart - yearStart);
}

function coeffIndex(n: number, m: number) {
  return (n * (n + 1)) / 2 + m;
}

function computeLegendrePcupLow(sinPhi: number, nMax: number) {
  const x = clamp(sinPhi, -1, 1);
  const z = Math.sqrt(Math.max(0, (1 - x) * (1 + x)));
  const numTerms = ((nMax + 1) * (nMax + 2)) / 2;

  const schmidt = new Array<number>(numTerms).fill(0);
  const pcup = new Array<number>(numTerms).fill(0);
  const dpcup = new Array<number>(numTerms).fill(0);

  schmidt[0] = 1;
  pcup[0] = 1;
  dpcup[0] = 0;

  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const i = coeffIndex(n, m);
      if (n === m) {
        const i1 = coeffIndex(n - 1, m - 1);
        pcup[i] = z * pcup[i1];
        dpcup[i] = z * dpcup[i1] + x * pcup[i1];
      } else if (n === 1 && m === 0) {
        const i1 = coeffIndex(n - 1, m);
        pcup[i] = x * pcup[i1];
        dpcup[i] = x * dpcup[i1] - z * pcup[i1];
      } else if (n > 1 && n !== m) {
        const i1 = coeffIndex(n - 2, m);
        const i2 = coeffIndex(n - 1, m);
        if (m > n - 2) {
          pcup[i] = x * pcup[i2];
          dpcup[i] = x * dpcup[i2] - z * pcup[i2];
        } else {
          const k = (((n - 1) * (n - 1)) - m * m) / ((2 * n - 1) * (2 * n - 3));
          pcup[i] = x * pcup[i2] - k * pcup[i1];
          dpcup[i] = x * dpcup[i2] - z * pcup[i2] - k * dpcup[i1];
        }
      }
    }
  }

  for (let n = 1; n <= nMax; n += 1) {
    const i0 = coeffIndex(n, 0);
    const prev = coeffIndex(n - 1, 0);
    schmidt[i0] = schmidt[prev] * ((2 * n - 1) / n);
    for (let m = 1; m <= n; m += 1) {
      const i = coeffIndex(n, m);
      const iPrev = coeffIndex(n, m - 1);
      schmidt[i] = schmidt[iPrev] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
    }
  }

  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const i = coeffIndex(n, m);
      pcup[i] *= schmidt[i];
      dpcup[i] *= -schmidt[i];
    }
  }

  return { pcup, dpcup };
}

function geodeticToSpherical(latDeg: number, lonDeg: number, altitudeKm: number) {
  const latRad = latDeg * DEG_TO_RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  const rc = WMM_A_KM / Math.sqrt(1 - WMM_EPS_SQ * sinLat * sinLat);
  const xp = (rc + altitudeKm) * cosLat;
  const zp = (rc * (1 - WMM_EPS_SQ) + altitudeKm) * sinLat;
  const r = Math.sqrt(xp * xp + zp * zp);
  const phigDeg = Math.asin(zp / r) * RAD_TO_DEG;

  return { rKm: r, phigDeg, lambdaDeg: lonDeg };
}

function getHarmonicVariables(lambdaDeg: number, rKm: number, nMax: number) {
  const lambdaRad = lambdaDeg * DEG_TO_RAD;
  const cosLambda = Math.cos(lambdaRad);
  const sinLambda = Math.sin(lambdaRad);
  const rr = WMM_REFERENCE_RADIUS_KM / rKm;

  const relativeRadiusPower = new Array<number>(nMax + 1).fill(0);
  relativeRadiusPower[0] = rr * rr;
  for (let n = 1; n <= nMax; n += 1) {
    relativeRadiusPower[n] = relativeRadiusPower[n - 1] * rr;
  }

  const cosMLambda = new Array<number>(nMax + 1).fill(0);
  const sinMLambda = new Array<number>(nMax + 1).fill(0);
  cosMLambda[0] = 1;
  sinMLambda[0] = 0;
  if (nMax >= 1) {
    cosMLambda[1] = cosLambda;
    sinMLambda[1] = sinLambda;
  }
  for (let m = 2; m <= nMax; m += 1) {
    cosMLambda[m] = cosMLambda[m - 1] * cosLambda - sinMLambda[m - 1] * sinLambda;
    sinMLambda[m] = cosMLambda[m - 1] * sinLambda + sinMLambda[m - 1] * cosLambda;
  }

  return { relativeRadiusPower, cosMLambda, sinMLambda };
}

function wmmDeclinationDeg(latDeg: number, lonDeg: number, date: Date, altitudeKm: number) {
  const whenMs = date.getTime();
  if (!Number.isFinite(whenMs)) return null;
  if (!(whenMs >= WMM_VALID_START_MS && whenMs <= WMM_VALID_END_MS)) return null;

  const nMax = WMM_2025.n_max;
  const dt = decimalYear(date) - WMM_2025.epoch;
  const timedG = WMM_2025.main_field_coeff_g.map((value, idx) => value + dt * (WMM_2025.secular_var_coeff_g[idx] ?? 0));
  const timedH = WMM_2025.main_field_coeff_h.map((value, idx) => value + dt * (WMM_2025.secular_var_coeff_h[idx] ?? 0));

  const spherical = geodeticToSpherical(latDeg, lonDeg, altitudeKm);
  const sinPhi = Math.sin(spherical.phigDeg * DEG_TO_RAD);
  const cosPhi = Math.cos(spherical.phigDeg * DEG_TO_RAD);
  const { pcup, dpcup } = computeLegendrePcupLow(sinPhi, nMax);
  const harmonic = getHarmonicVariables(spherical.lambdaDeg, spherical.rKm, nMax);

  let bx = 0;
  let by = 0;
  let bz = 0;

  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const i = coeffIndex(n, m);
      const g = timedG[i] ?? 0;
      const h = timedH[i] ?? 0;
      const cosM = harmonic.cosMLambda[m] ?? 0;
      const sinM = harmonic.sinMLambda[m] ?? 0;
      const common = g * cosM + h * sinM;
      const rr = harmonic.relativeRadiusPower[n] ?? 0;
      const p = pcup[i] ?? 0;

      bz -= rr * common * (n + 1) * p;
      by += rr * (g * sinM - h * cosM) * m * p;
      bx -= rr * common * (dpcup[i] ?? 0);
    }
  }

  if (Math.abs(cosPhi) > 1e-10) {
    by /= cosPhi;
  } else {
    by = 0;
    const sinPhiGeo = Math.sin(spherical.phigDeg * DEG_TO_RAD);
    const pcupS = [1];
    let schmidtQuasiNorm1 = 1;

    for (let n = 1; n <= nMax; n += 1) {
      const schmidtQuasiNorm2 = schmidtQuasiNorm1 * ((2 * n - 1) / n);
      const schmidtQuasiNorm3 = schmidtQuasiNorm2 * Math.sqrt((2 * n) / (n + 1));
      schmidtQuasiNorm1 = schmidtQuasiNorm2;

      if (n === 1) {
        pcupS[n] = pcupS[n - 1];
      } else {
        const k = (((n - 1) * (n - 1)) - 1) / ((2 * n - 1) * (2 * n - 3));
        pcupS[n] = sinPhiGeo * pcupS[n - 1] - k * (pcupS[n - 2] ?? 0);
      }

      const i = coeffIndex(n, 1);
      const g = timedG[i] ?? 0;
      const h = timedH[i] ?? 0;
      const rr = harmonic.relativeRadiusPower[n] ?? 0;
      by += rr * (g * (harmonic.sinMLambda[1] ?? 0) - h * (harmonic.cosMLambda[1] ?? 0)) * pcupS[n] * schmidtQuasiNorm3;
    }
  }

  const psi = (spherical.phigDeg - latDeg) * DEG_TO_RAD;
  const bxGeo = bx * Math.cos(psi) - bz * Math.sin(psi);
  const byGeo = by;
  const decl = Math.atan2(byGeo, bxGeo) * RAD_TO_DEG;
  if (!Number.isFinite(decl)) return null;
  return normalizeAngleDelta(decl);
}

export function getDeclinationDeg({
  lat,
  lon,
  atDate = new Date(),
  altitudeKm = 0
}: {
  lat: number;
  lon: number;
  atDate?: Date;
  altitudeKm?: number;
}): DeclinationResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { declinationDeg: 0, source: 'none' };
  }

  const wmmDecl = wmmDeclinationDeg(lat, lon, atDate, altitudeKm);
  if (wmmDecl != null && Number.isFinite(wmmDecl)) {
    return {
      declinationDeg: clamp(wmmDecl, -MAX_DECLINATION_DEG, MAX_DECLINATION_DEG),
      source: 'wmm'
    };
  }

  const approxDecl = approximateMagneticDeclinationDeg(lat, lon);
  if (Number.isFinite(approxDecl)) {
    return {
      declinationDeg: clamp(approxDecl, -MAX_DECLINATION_DEG, MAX_DECLINATION_DEG),
      source: 'approx'
    };
  }

  return { declinationDeg: 0, source: 'none' };
}
