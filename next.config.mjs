/**
 * @fileoverview Next.js Configuration
 * @description Production-ready Next.js configuration with strict type checking
 * and ESLint validation enabled for enterprise deployment.
 * @version 2.0.0
 */

/** @type {import('next').NextConfig} */
const config = {
  // Enable React Strict Mode for highlighting potential problems
  reactStrictMode: true,

  // Remove X-Powered-By header for security
  poweredByHeader: false,

  // ESLint Configuration
  // PRODUCTION: Set to false to enable ESLint checks during builds
  // During development/migration: Set to true to bypass ESLint errors
  eslint: {
    ignoreDuringBuilds: process.env.SKIP_LINT === 'true',
    // Directories to lint
    dirs: ['src'],
  },

  // TypeScript Configuration
  // PRODUCTION: Set to false to enable TypeScript strict checks during builds
  // During development/migration: Set to true to bypass TypeScript errors
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TYPECHECK === 'true',
  },

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  // Experimental features
  experimental: {
    serverComponentsExternalPackages: ["@napi-rs/canvas", "canvas"],
  },

  // Webpack configuration
  webpack: (cfg, { isServer }) => {
    // Server-side external packages
    if (isServer) {
      const externals = new Set([...(cfg.externals || [])]);
      externals.add("@napi-rs/canvas");
      externals.add("canvas");
      cfg.externals = Array.from(externals);
    }

    // Exclude service worker files from webpack processing
    cfg.module = cfg.module || {};
    cfg.module.rules = cfg.module.rules || [];
    cfg.module.rules.push({
      test: /firebase-messaging-sw\.js$/,
      use: "ignore-loader",
    });

    return cfg;
  },

  // Security headers for production
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default config;
