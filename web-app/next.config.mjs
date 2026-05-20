/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages cannot serve Next.js image optimization out of the box.
  // Disable it for Phase W1 — we're shipping a thin dashboard with no images
  // beyond the brand logo, which lives in /public and is served as-is.
  images: { unoptimized: true },

  // The middleware needs to run on every route to enforce auth; keep the
  // build emitting an edge-runtime middleware bundle.
  experimental: {
    // No experimental flags needed for our use case; placeholder for future.
  },
};

export default nextConfig;
