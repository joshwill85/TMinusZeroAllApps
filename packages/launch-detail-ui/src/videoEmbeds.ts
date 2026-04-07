export type LaunchVideoEmbed = {
  src: string;
  title: string;
  provider: 'YouTube' | 'Vimeo';
  thumbnailUrl: string | null;
};

export function buildLaunchVideoEmbed(url: string): LaunchVideoEmbed | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    const youtubeId = parseYouTubeVideoId(parsed, host);
    if (youtubeId) {
      const embed = new URL(`https://www.youtube-nocookie.com/embed/${youtubeId}`);
      embed.searchParams.set('rel', '0');
      embed.searchParams.set('modestbranding', '1');
      embed.searchParams.set('playsinline', '1');
      const startSeconds = parseYouTubeStartSeconds(parsed);
      if (startSeconds != null) {
        embed.searchParams.set('start', String(startSeconds));
      }
      return {
        src: embed.toString(),
        title: 'YouTube video player',
        provider: 'YouTube',
        thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
      };
    }

    const vimeoId = parseVimeoVideoId(parsed, host);
    if (vimeoId) {
      return {
        src: `https://player.vimeo.com/video/${vimeoId}`,
        title: 'Vimeo video player',
        provider: 'Vimeo',
        thumbnailUrl: null
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseYouTubeVideoId(url: URL, host: string): string | null {
  const isYouTubeHost =
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com');
  if (!isYouTubeHost) return null;

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return isValidYouTubeId(id) ? id : null;
  }

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    return isValidYouTubeId(id) ? id : null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'embed') {
    const id = segments[1];
    return isValidYouTubeId(id) ? id : null;
  }

  if (segments.length >= 2 && (segments[0] === 'live' || segments[0] === 'shorts')) {
    const id = segments[1];
    return isValidYouTubeId(id) ? id : null;
  }

  const fallback = url.searchParams.get('v');
  return isValidYouTubeId(fallback) ? fallback : null;
}

function isValidYouTubeId(value: string | null | undefined) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[a-zA-Z0-9_-]{6,}$/.test(trimmed);
}

function parseYouTubeStartSeconds(url: URL): number | null {
  const candidates = [url.searchParams.get('start'), url.searchParams.get('t'), url.searchParams.get('time_continue')];
  const hash = url.hash ? url.hash.replace(/^#/, '') : '';
  if (hash.startsWith('t=')) candidates.push(hash.slice(2));

  for (const value of candidates) {
    const seconds = parseDurationSeconds(value);
    if (seconds != null) return seconds;
  }
  return null;
}

function parseDurationSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  const seconds = match[3] ? Number(match[3]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total >= 0 ? total : null;
}

function parseVimeoVideoId(url: URL, host: string): string | null {
  if (!(host === 'vimeo.com' || host.endsWith('.vimeo.com'))) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) return null;

  if (host === 'player.vimeo.com' && segments.length >= 2 && segments[0] === 'video') {
    return /^\d+$/.test(segments[1]) ? segments[1] : null;
  }

  const first = segments[0];
  return /^\d+$/.test(first) ? first : null;
}
