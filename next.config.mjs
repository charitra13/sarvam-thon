/** @type {import('next').NextConfig} */
export default {
  // Slip photos are downscaled in the browser; this leaves headroom under Vercel's 4.5 MB body cap.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};
