import type { NextConfig } from "next";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Everything is unframeable except the hosted chat window, whose route sets
// its own CSP frame-ancestors from the widget's allowed origins.
const securityHeaders = [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/((?!chat/).*)", headers: securityHeaders },
      { source: "/chat/:path*", headers: baseHeaders },
    ];
  },
};

export default nextConfig;
