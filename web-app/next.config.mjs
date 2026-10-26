/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image optimization is not used (the only image is the uploaded brand
  // logo, rendered with a plain <img>). Keeping it off also keeps the image
  // optimizer — the subject of several Next.js advisories — out of the app.
  images: { unoptimized: true },
};

export default nextConfig;

