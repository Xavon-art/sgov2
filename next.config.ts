import type { NextConfig } from "next";

/**
 * Response headers the hosting edge does not already set.
 *
 * Deliberately absent, each verified against the live site rather than assumed:
 *  - HSTS: Vercel already returns `max-age=63072000; includeSubDomains; preload`.
 *  - Cache-Control on `/_next/static/**`: already `public,max-age=31536000,immutable`.
 *  - Anything route-shaped: `/dashboard` and the `/api/**` handlers are dynamic
 *    and per-request; a long max-age on them would pin one user's response.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the app embeds a frame and nothing offers an embeddable surface,
  // so both clickjacking controls are safe. frame-ancestors is the one CSP
  // directive that needs no script-src exception, which is why a CSP is set here
  // at all: the rest of the policy needs 'unsafe-inline' for Next's inline
  // bootstrap script and the inline style props, which would make it theatre.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // No camera, microphone, or geolocation use anywhere in src/.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Emitted by send-payload on every server-rendered response. Prerendered
  // pages are served from the CDN cache and never reach that code, so this
  // strips the fingerprint from /dashboard and the API routes.
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/usg/survey", destination: "/usg/forms?type=survey", permanent: false },
      { source: "/lsg/survey", destination: "/lsg/forms?type=survey", permanent: false },
      { source: "/usg/surveys", destination: "/usg/forms?type=survey", permanent: false },
      { source: "/lsg/surveys", destination: "/lsg/forms?type=survey", permanent: false },
      {
        source: "/usg/surveys/:id",
        destination: "/usg/forms?type=survey&id=:id",
        permanent: false,
      },
      {
        source: "/lsg/surveys/:id",
        destination: "/lsg/forms?type=survey&id=:id",
        permanent: false,
      },
      { source: "/survey/:id", destination: "/forms/survey/:id", permanent: false },
      { source: "/feedback/f/:token", destination: "/forms/feedback/:token", permanent: false },
      {
        source: "/usg/officers",
        destination: "/usg/manage?tab=people&view=officers",
        permanent: false,
      },
      {
        source: "/usg/accounts",
        destination: "/usg/manage?tab=people&view=permissions",
        permanent: false,
      },
      {
        source: "/usg/invites",
        destination: "/usg/manage?tab=people&view=invites",
        permanent: false,
      },
      {
        source: "/usg/umbrella",
        destination: "/usg/manage?tab=people&view=units",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
