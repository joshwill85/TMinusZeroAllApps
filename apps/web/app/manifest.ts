import type { MetadataRoute } from 'next';

import { BRAND_NAME } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND_NAME} — US Launch Schedule & Tracker`,
    short_name: BRAND_NAME,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#05060A',
    theme_color: '#05060A',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/rocket.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  };
}

