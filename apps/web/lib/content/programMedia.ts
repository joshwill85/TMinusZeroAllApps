export type ProgramMediaEntry = {
  id: string;
  title: string;
  url: string;
  kind: 'video' | 'images' | 'news' | 'missions' | 'social' | 'policy' | 'data';
  sourceClass: 'official' | 'trusted-reference';
  notes: string;
};

export type ProgramImagePolicyNote = {
  id: string;
  title: string;
  url: string;
  guidance: string;
};

export const SPACEX_MEDIA_ARCHIVE: ProgramMediaEntry[] = [
  {
    id: 'spacex:launches',
    title: 'SpaceX Launches',
    url: 'https://www.spacex.com/launches/',
    kind: 'missions',
    sourceClass: 'official',
    notes: 'Canonical manifest and mission recap index.'
  },
  {
    id: 'spacex:updates',
    title: 'SpaceX Updates',
    url: 'https://www.spacex.com/updates/',
    kind: 'news',
    sourceClass: 'official',
    notes: 'Program updates and release notes.'
  },
  {
    id: 'spacex:media',
    title: 'SpaceX Media',
    url: 'https://www.spacex.com/media/',
    kind: 'images',
    sourceClass: 'official',
    notes: 'Press/media-facing imagery and assets.'
  },
  {
    id: 'spacex:flickr',
    title: 'Official SpaceX Photos (Flickr)',
    url: 'https://www.flickr.com/photos/spacex/',
    kind: 'images',
    sourceClass: 'trusted-reference',
    notes: 'Asset-level licensing and attribution details are listed per photo.'
  },
  {
    id: 'spacex:youtube',
    title: 'SpaceX YouTube Channel',
    url: 'https://www.youtube.com/@SpaceX',
    kind: 'video',
    sourceClass: 'official',
    notes: 'Webcast archive and mission videos.'
  },
  {
    id: 'spacex:x',
    title: 'SpaceX on X',
    url: 'https://x.com/SpaceX',
    kind: 'social',
    sourceClass: 'official',
    notes: 'Operational updates and launch thread posts.'
  }
];

export const BLUE_ORIGIN_MEDIA_ARCHIVE: ProgramMediaEntry[] = [
  {
    id: 'blueorigin:missions',
    title: 'Blue Origin Missions',
    url: 'https://www.blueorigin.com/missions',
    kind: 'missions',
    sourceClass: 'official',
    notes: 'Primary mission index and flight pages.'
  },
  {
    id: 'blueorigin:news',
    title: 'Blue Origin News',
    url: 'https://www.blueorigin.com/news',
    kind: 'news',
    sourceClass: 'official',
    notes: 'Program and launch announcements.'
  },
  {
    id: 'blueorigin:gallery',
    title: 'Blue Origin Gallery',
    url: 'https://www.blueorigin.com/news/gallery',
    kind: 'images',
    sourceClass: 'official',
    notes: 'Official photo archive and mission visuals.'
  },
  {
    id: 'blueorigin:youtube',
    title: 'Blue Origin YouTube Channel',
    url: 'https://www.youtube.com/@blueorigin',
    kind: 'video',
    sourceClass: 'official',
    notes: 'Flight recaps and mission video clips.'
  },
  {
    id: 'blueorigin:x',
    title: 'Blue Origin on X',
    url: 'https://x.com/blueorigin',
    kind: 'social',
    sourceClass: 'official',
    notes: 'Launch, mission, and program status updates.'
  },
  {
    id: 'blueorigin:faa',
    title: 'FAA Commercial Space Data',
    url: 'https://www.faa.gov/data_research/commercial_space_data',
    kind: 'data',
    sourceClass: 'trusted-reference',
    notes: 'Authoritative U.S. regulatory records for licensed launches.'
  }
];

export const SPACEX_IMAGE_POLICY_NOTES: ProgramImagePolicyNote[] = [
  {
    id: 'spacex:flickr-license',
    title: 'Use photo-level licensing from Official SpaceX Photos (Flickr)',
    url: 'https://www.flickr.com/photos/spacex/',
    guidance: 'For still imagery, ingest only assets with explicit license and attribution metadata.'
  },
  {
    id: 'spacex:media-source',
    title: 'Prefer SpaceX media/mission pages for official imagery',
    url: 'https://www.spacex.com/media/',
    guidance: 'Treat website imagery as copyrighted unless explicit reuse terms are stated.'
  }
];

export const BLUE_ORIGIN_IMAGE_POLICY_NOTES: ProgramImagePolicyNote[] = [
  {
    id: 'blueorigin:gallery-credit',
    title: 'Blue Origin gallery requires clear source attribution',
    url: 'https://www.blueorigin.com/news/gallery',
    guidance: 'Include source credit when ingesting gallery assets and keep canonical media URLs.'
  },
  {
    id: 'blueorigin:terms',
    title: 'Blue Origin Terms of Use',
    url: 'https://shop.blueorigin.com/pages/terms-of-use',
    guidance: 'Assume copyrighted material unless explicit permission or license language is attached.'
  }
];
