import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const home = new URL(import.meta.env.BASE_URL, site);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${home.href}</loc></url></urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
