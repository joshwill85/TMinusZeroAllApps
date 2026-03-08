import { normalizeImageUrl } from '@/lib/utils/imageUrl';

export type ManifestPassengerInput = {
  id: string;
  name: string;
  role?: string | null;
  avatarUrl?: string | null;
  seatIndex?: number | null;
  confidence?: 'high' | 'medium' | 'low';
};

export type ManifestPayloadInput = {
  id: string;
  name: string;
  payloadType?: string | null;
};

export type ManifestSeat = {
  id: number;
  label: string;
  traveler?: {
    name: string;
    role: string;
    avatarUrl?: string | null;
  };
  payload?: {
    name: string;
    description?: string;
  };
};

export type ManifestBuildResult = {
  seats: ManifestSeat[];
  hasExplicitSeatAssignments: boolean;
};

export type ManifestBuildOptions = {
  fillEmptySlots?: boolean;
};

export type MediaPreviewInput = {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string | null;
};

export type MediaPreviewResult =
  | { kind: 'image'; imageUrl: string }
  | { kind: 'video-placeholder' }
  | { kind: 'image-placeholder' };

export function buildManifestSeats(
  passengers: ManifestPassengerInput[],
  payloads: ManifestPayloadInput[],
  seatCount = 6,
  options: ManifestBuildOptions = {}
): ManifestBuildResult {
  const boundedSeatCount = Math.max(1, Math.floor(seatCount));
  const fillEmptySlots = options.fillEmptySlots ?? true;
  const seatMap = new Map<number, ManifestSeat>();
  const assignedPassengerIds = new Set<string>();

  const explicitSeatPassengers = passengers
    .filter((passenger) =>
      isSeatIndexInRange(passenger.seatIndex, boundedSeatCount)
    )
    .sort((left, right) => {
      const leftSeatIndex = left.seatIndex as number;
      const rightSeatIndex = right.seatIndex as number;
      if (leftSeatIndex !== rightSeatIndex)
        return leftSeatIndex - rightSeatIndex;
      return comparePassengerFallback(left, right);
    });

  for (const passenger of explicitSeatPassengers) {
    const seatIndex = passenger.seatIndex as number;
    if (seatMap.has(seatIndex)) continue;
    seatMap.set(seatIndex, buildTravelerSeat(seatIndex, passenger, true));
    assignedPassengerIds.add(passenger.id);
  }

  const rosterPassengers = passengers
    .filter((passenger) => !assignedPassengerIds.has(passenger.id))
    .sort(comparePassengerFallback);
  const sortedPayloads = [...payloads].sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name, undefined, {
      sensitivity: 'base'
    });
    if (nameComparison !== 0) return nameComparison;
    return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
  });

  let passengerCursor = 0;
  let payloadCursor = 0;
  const seats: ManifestSeat[] = [];

  for (let seatId = 1; seatId <= boundedSeatCount; seatId += 1) {
    const explicitSeat = seatMap.get(seatId);
    if (explicitSeat) {
      seats.push(explicitSeat);
      continue;
    }

    const nextPassenger = rosterPassengers[passengerCursor];
    if (nextPassenger) {
      seats.push(buildTravelerSeat(seatId, nextPassenger, false));
      passengerCursor += 1;
      continue;
    }

    const nextPayload = sortedPayloads[payloadCursor];
    if (nextPayload) {
      seats.push({
        id: seatId,
        label: `Slot ${seatId}`,
        payload: {
          name: nextPayload.name,
          description: nextPayload.payloadType || undefined
        }
      });
      payloadCursor += 1;
      continue;
    }

    if (!fillEmptySlots) continue;
    seats.push({ id: seatId, label: `Position ${seatId}` });
  }

  return {
    seats,
    hasExplicitSeatAssignments: explicitSeatPassengers.length > 0
  };
}

export function sortByDateDesc<T>(
  items: T[],
  readDate: (item: T) => string | null | undefined,
  readTieBreaker?: (item: T) => string
) {
  return [...items].sort((left, right) => {
    const leftDate = parseDateToEpoch(readDate(left));
    const rightDate = parseDateToEpoch(readDate(right));

    if (leftDate != null && rightDate != null && leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    if (leftDate != null && rightDate == null) return -1;
    if (leftDate == null && rightDate != null) return 1;

    if (readTieBreaker) {
      return readTieBreaker(left).localeCompare(
        readTieBreaker(right),
        undefined,
        {
          numeric: true,
          sensitivity: 'base'
        }
      );
    }
    return 0;
  });
}

export function sortByDateAsc<T>(
  items: T[],
  readDate: (item: T) => string | null | undefined,
  readTieBreaker?: (item: T) => string
) {
  return [...items].sort((left, right) => {
    const leftDate = parseDateToEpoch(readDate(left));
    const rightDate = parseDateToEpoch(readDate(right));

    if (leftDate != null && rightDate != null && leftDate !== rightDate) {
      return leftDate - rightDate;
    }
    if (leftDate != null && rightDate == null) return -1;
    if (leftDate == null && rightDate != null) return 1;

    if (readTieBreaker) {
      return readTieBreaker(left).localeCompare(
        readTieBreaker(right),
        undefined,
        {
          numeric: true,
          sensitivity: 'base'
        }
      );
    }
    return 0;
  });
}

export function getCircularIndex(
  currentIndex: number,
  step: number,
  total: number
) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const next = (currentIndex + step) % total;
  return next < 0 ? next + total : next;
}

export function resolveMediaPreview(
  item: MediaPreviewInput
): MediaPreviewResult {
  const candidateImageUrl = normalizeImageUrl(item.thumbnailUrl ?? item.url);

  if (item.type === 'video') {
    if (
      candidateImageUrl &&
      isLikelyImageUrl(candidateImageUrl) &&
      item.thumbnailUrl
    ) {
      return { kind: 'image', imageUrl: candidateImageUrl };
    }
    return { kind: 'video-placeholder' };
  }

  if (candidateImageUrl && item.thumbnailUrl && isLikelyImageUrl(candidateImageUrl)) {
    return { kind: 'image', imageUrl: candidateImageUrl };
  }

  const fallbackImageUrl = normalizeImageUrl(item.url);
  if (fallbackImageUrl && isLikelyImageUrl(fallbackImageUrl)) {
    return { kind: 'image', imageUrl: fallbackImageUrl };
  }

  return { kind: 'image-placeholder' };
}

function isSeatIndexInRange(
  value: number | null | undefined,
  seatCount: number
): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= seatCount
  );
}

function buildTravelerSeat(
  seatId: number,
  passenger: ManifestPassengerInput,
  isExplicitSeat: boolean
): ManifestSeat {
  const normalizedAvatarUrl = normalizeImageUrl(passenger.avatarUrl);
  return {
    id: seatId,
    label: `${isExplicitSeat ? 'Seat' : 'Position'} ${seatId}`,
    traveler: {
      name: passenger.name,
      role: passenger.role || 'Passenger',
      avatarUrl: normalizedAvatarUrl ?? undefined
    }
  };
}

function comparePassengerFallback(
  left: ManifestPassengerInput,
  right: ManifestPassengerInput
) {
  const confidenceDelta =
    confidenceRank(right.confidence) - confidenceRank(left.confidence);
  if (confidenceDelta !== 0) return confidenceDelta;

  const nameComparison = left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base'
  });
  if (nameComparison !== 0) return nameComparison;
  return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
}

function confidenceRank(value: ManifestPassengerInput['confidence']) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function parseDateToEpoch(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function isLikelyImageUrl(value: string | null | undefined) {
  if (!value) return false;

  const lower = value.toLowerCase();
  const extensionPattern = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i;
  if (extensionPattern.test(lower)) return true;
  if (
    /[?&](?:format|fm|ext)=(?:avif|gif|ico|jpe?g|png|svg|webp)\b/i.test(lower)
  )
    return true;
  if (lower.includes('ytimg.com/')) return true;
  if (lower.includes('twimg.com/media/')) return true;
  return false;
}
