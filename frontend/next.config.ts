import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` gets its own output folder, so running `next build` alongside it can't
  // overwrite the dev server's manifests.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  images: { formats: ['image/avif', 'image/webp'] },
  // The WASM verifier (packages/pof-wasm-pkg) is loaded lazily on /verify only.
  // Async WebAssembly is enabled now so the swap is a one-line adapter change.
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true }
    return config
  },
}

export default nextConfig
