/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  experimental: {
    serverComponentsExternalPackages: ["@napi-rs/canvas", "canvas"],
  },
  webpack: (cfg, { isServer }) => {
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
};
export default config;
