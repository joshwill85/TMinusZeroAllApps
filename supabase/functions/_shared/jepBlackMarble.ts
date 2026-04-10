export const BLACK_MARBLE_COLLECTION_ID = '5200';
export const BLACK_MARBLE_MONTHLY_SOURCE_KEY = 'nasa_black_marble_vnp46a3';
export const BLACK_MARBLE_YEARLY_SOURCE_KEY = 'nasa_black_marble_vnp46a4';
export const BLACK_MARBLE_TILE_DEG = 10;
export const BLACK_MARBLE_TILE_PIXELS = 2400;
export const BLACK_MARBLE_PIXEL_DEG = BLACK_MARBLE_TILE_DEG / BLACK_MARBLE_TILE_PIXELS;
export const BLACK_MARBLE_VALID_LAND_MASKS = new Set([0, 1, 5]);

export type BlackMarbleProductKey = 'VNP46A3' | 'VNP46A4';

export type BlackMarblePeriod = {
  productKey: BlackMarbleProductKey;
  sourceKey: string;
  periodCode: string;
  periodStartDate: string;
  periodEndDate: string;
  directoryYear: number;
  directoryDoy: number;
};

export type BlackMarbleTileAddress = {
  tileH: number;
  tileV: number;
  rowIndex: number;
  colIndex: number;
  tileWestLonDeg: number;
  tileEastLonDeg: number;
  tileNorthLatDeg: number;
  tileSouthLatDeg: number;
  cellCenterLatDeg: number;
  cellCenterLonDeg: number;
};

export type ResolvedBlackMarbleFile = {
  productKey: BlackMarbleProductKey;
  sourceKey: string;
  filename: string;
  contentsUrl: string;
  archiveUrl: string;
  ddsUrl: string;
  dmrHtmlUrl: string;
  directoryYear: number;
  directoryDoy: number;
  tileH: number;
  tileV: number;
};

export function deriveBlackMarbleTileAddress(latDeg: number, lonDeg: number): BlackMarbleTileAddress | null {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  if (latDeg < -90 || latDeg > 90 || lonDeg < -180 || lonDeg > 180) return null;

  const tileH = clampInt(Math.floor((normalizeLon(lonDeg) + 180) / BLACK_MARBLE_TILE_DEG), 0, 35);
  const tileV = clampInt(Math.floor((90 - clamp(latDeg, -90, 90)) / BLACK_MARBLE_TILE_DEG), 0, 17);
  const tileWestLonDeg = -180 + tileH * BLACK_MARBLE_TILE_DEG;
  const tileEastLonDeg = tileWestLonDeg + BLACK_MARBLE_TILE_DEG;
  const tileNorthLatDeg = 90 - tileV * BLACK_MARBLE_TILE_DEG;
  const tileSouthLatDeg = tileNorthLatDeg - BLACK_MARBLE_TILE_DEG;

  const colPosition = ((normalizeLon(lonDeg) - tileWestLonDeg) / BLACK_MARBLE_PIXEL_DEG) - 0.5;
  const rowPosition = ((tileNorthLatDeg - clamp(latDeg, -90, 90)) / BLACK_MARBLE_PIXEL_DEG) - 0.5;
  const colIndex = clampInt(Math.round(colPosition), 0, BLACK_MARBLE_TILE_PIXELS - 1);
  const rowIndex = clampInt(Math.round(rowPosition), 0, BLACK_MARBLE_TILE_PIXELS - 1);

  return {
    tileH,
    tileV,
    rowIndex,
    colIndex,
    tileWestLonDeg,
    tileEastLonDeg,
    tileNorthLatDeg,
    tileSouthLatDeg,
    cellCenterLatDeg: tileNorthLatDeg - (rowIndex + 0.5) * BLACK_MARBLE_PIXEL_DEG,
    cellCenterLonDeg: tileWestLonDeg + (colIndex + 0.5) * BLACK_MARBLE_PIXEL_DEG
  };
}

export function deriveBlackMarblePeriod(productKey: BlackMarbleProductKey, launchAtIso: string): BlackMarblePeriod | null {
  const launchAtMs = Date.parse(launchAtIso);
  if (!Number.isFinite(launchAtMs)) return null;
  const date = new Date(launchAtMs);
  const year = date.getUTCFullYear();

  if (productKey === 'VNP46A3') {
    const month = date.getUTCMonth();
    const periodStart = new Date(Date.UTC(year, month, 1));
    const periodEnd = new Date(Date.UTC(year, month + 1, 0));
    return {
      productKey,
      sourceKey: BLACK_MARBLE_MONTHLY_SOURCE_KEY,
      periodCode: `A${year}${formatDayOfYear(dayOfYearUtc(periodStart))}`,
      periodStartDate: formatDate(periodStart),
      periodEndDate: formatDate(periodEnd),
      directoryYear: year,
      directoryDoy: dayOfYearUtc(periodStart)
    };
  }

  const periodStart = new Date(Date.UTC(year, 0, 1));
  const periodEnd = new Date(Date.UTC(year, 11, 31));
  return {
    productKey,
    sourceKey: BLACK_MARBLE_YEARLY_SOURCE_KEY,
    periodCode: `A${year}001`,
    periodStartDate: formatDate(periodStart),
    periodEndDate: formatDate(periodEnd),
    directoryYear: year,
    directoryDoy: 1
  };
}

export function resolveBlackMarbleFileFromContents({
  productKey,
  period,
  tileH,
  tileV,
  contentsHtml
}: {
  productKey: BlackMarbleProductKey;
  period: BlackMarblePeriod;
  tileH: number;
  tileV: number;
  contentsHtml: string;
}): ResolvedBlackMarbleFile | null {
  const tileToken = `h${String(tileH).padStart(2, '0')}v${String(tileV).padStart(2, '0')}`;
  const filename = findLatestBlackMarbleFilename(contentsHtml, {
    productKey,
    periodCode: period.periodCode,
    tileToken
  });
  if (!filename) return null;

  const dirPath = `${BLACK_MARBLE_COLLECTION_ID}/${productKey}/${period.directoryYear}/${formatDayOfYear(period.directoryDoy)}`;
  const baseOpens = `https://ladsweb.modaps.eosdis.nasa.gov/opendap/RemoteResources/laads/allData/${dirPath}`;
  const baseArchive = `https://ladsweb.modaps.eosdis.nasa.gov/api/v2/content/archives/allData/${dirPath}`;

  return {
    productKey,
    sourceKey: period.sourceKey,
    filename,
    contentsUrl: `${baseOpens}/contents.html`,
    archiveUrl: `${baseArchive}/${filename}`,
    ddsUrl: `${baseOpens}/${filename}.dds`,
    dmrHtmlUrl: `${baseOpens}/${filename}.dmr.html`,
    directoryYear: period.directoryYear,
    directoryDoy: period.directoryDoy,
    tileH,
    tileV
  };
}

export function isBlackMarbleLandMask(maskCode: number | null) {
  return maskCode != null && BLACK_MARBLE_VALID_LAND_MASKS.has(maskCode);
}

function findLatestBlackMarbleFilename(
  contentsHtml: string,
  {
    productKey,
    periodCode,
    tileToken
  }: {
    productKey: BlackMarbleProductKey;
    periodCode: string;
    tileToken: string;
  }
) {
  const pattern = new RegExp(`${productKey}\\.${periodCode}\\.${tileToken}\\.002\\.[0-9]+\\.h5`, 'g');
  const matches = contentsHtml.match(pattern) || [];
  if (!matches.length) return null;
  return [...matches].sort().at(-1) || null;
}

function normalizeLon(value: number) {
  const normalized = value === 180 ? 179.999999 : value;
  return clamp(normalized, -180, 180);
}

function dayOfYearUtc(value: Date) {
  const year = value.getUTCFullYear();
  const start = Date.UTC(year, 0, 0);
  return Math.floor((value.getTime() - start) / 86400000);
}

function formatDayOfYear(value: number) {
  return String(clampInt(value, 1, 366)).padStart(3, '0');
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
