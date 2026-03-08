const DEG_TO_RAD = Math.PI / 180;

const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

export function ecefFromLatLon(latDeg: number, lonDeg: number, altMeters = 0) {
  const lat = latDeg * DEG_TO_RAD;
  const lon = lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const x = (N + altMeters) * cosLat * cosLon;
  const y = (N + altMeters) * cosLat * sinLon;
  const z = (N * (1 - WGS84_E2) + altMeters) * sinLat;
  return [x, y, z] as [number, number, number];
}

export function enuFromEcef(
  userLatDeg: number,
  userLonDeg: number,
  userEcef: [number, number, number],
  targetEcef: [number, number, number]
) {
  const lat = userLatDeg * DEG_TO_RAD;
  const lon = userLonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const dx = targetEcef[0] - userEcef[0];
  const dy = targetEcef[1] - userEcef[1];
  const dz = targetEcef[2] - userEcef[2];

  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  return [east, north, up] as [number, number, number];
}

export function azElFromEnu(enu: [number, number, number]) {
  const [east, north, up] = enu;
  const az = Math.atan2(east, north);
  const horiz = Math.sqrt(east * east + north * north);
  const el = Math.atan2(up, horiz);
  const azDeg = (az * 180) / Math.PI;
  const elDeg = (el * 180) / Math.PI;
  return {
    azDeg: (azDeg + 360) % 360,
    elDeg
  };
}
