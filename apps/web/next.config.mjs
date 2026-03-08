const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload'
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests'
    ].join('; ')
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()'
  }
];

const arSecurityHeaders = securityHeaders.map((header) =>
  header.key === 'Permissions-Policy'
    ? {
        key: 'Permissions-Policy',
        // AR requires sensors + camera; keep microphone disabled.
        value: 'camera=(self), microphone=(), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)'
      }
    : header
);

const embedHeaders = securityHeaders
  .filter((header) => header.key !== 'Content-Security-Policy' && header.key !== 'X-Frame-Options')
  .concat([
    {
      key: 'Content-Security-Policy',
      value: [
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors *",
        "form-action 'self'",
        'upgrade-insecure-requests'
      ].join('; ')
    }
  ]);

const sharedPackages = [
  '@tminuszero/api-client',
  '@tminuszero/contracts',
  '@tminuszero/design-tokens',
  '@tminuszero/domain',
  '@tminuszero/navigation',
  '@tminuszero/query'
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: sharedPackages,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'spacelaunchnow-prod-east.nyc3.digitaloceanspaces.com'
      },
      {
        protocol: 'https',
        hostname: 'images2.imgbox.com'
      },
      {
        protocol: 'https',
        hostname: 'imgur.com'
      },
      {
        protocol: 'https',
        hostname: 'www.nasa.gov'
      },
      {
        protocol: 'https',
        hostname: 'images-assets.nasa.gov'
      },
      {
        protocol: 'https',
        hostname: 'www.asc-csa.gc.ca'
      }
    ]
  },
  async redirects() {
    return [
      {
        source: '/artemis-2',
        destination: '/artemis-ii',
        permanent: true
      },
      {
        source: '/artemis-2/',
        destination: '/artemis-ii',
        permanent: true
      },
      {
        source: '/spacex/jellyfish-effect',
        destination: '/jellyfish-effect',
        permanent: true
      },
      {
        source: '/spacex/jellyfish-effect/:path*',
        destination: '/jellyfish-effect/:path*',
        permanent: true
      }
    ];
  },
  async headers() {
    if (process.env.NODE_ENV !== 'production') {
      return [];
    }

    return [
      {
        source: '/embed/:path*',
        headers: embedHeaders
      },
      {
        source: '/launches/:id/ar',
        headers: arSecurityHeaders
      },
      {
        source: '/((?!embed(?:/|$)).*)',
        headers: securityHeaders
      }
    ];
  },
  experimental: {
    externalDir: true,
    serverActions: {
      bodySizeLimit: '2mb'
    },
    outputFileTracingIncludes: {
      '/api/admin/sync': ['../../node_modules/pdfjs-dist/build/pdf.worker.mjs']
    }
  }
};

export default nextConfig;
