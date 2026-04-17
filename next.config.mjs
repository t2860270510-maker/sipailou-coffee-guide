if (process.env.NODE_ENV === "development") {
  const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");

  initOpenNextCloudflareForDev();
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
