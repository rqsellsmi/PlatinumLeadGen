/** @type {import('next').NextConfig} */

// Content Security Policy (Section 13.1). Do NOT disable.
// Allowances: Google Maps + GTM scripts, RentCast + Maps connect, Tailwind inline styles,
// remote property photos over https.
const ContentSecurityPolicy = [
  "default-src 'self'",
  // GTM and Google Maps inject inline + external scripts. 'unsafe-eval' is required by the
  // Maps JS SDK. 'unsafe-inline' covers GTM bootstrap + Next.js inline runtime.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https: https://maps.gstatic.com https://maps.googleapis.com https://www.google-analytics.com https://www.googletagmanager.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https://maps.googleapis.com https://api.rentcast.io https://www.google-analytics.com https://www.googletagmanager.com",
  // https://www.google.com/maps/embed serves the listing-page Neighborhood map iframe.
  "frame-src 'self' https://www.googletagmanager.com https://www.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: ContentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self)' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
