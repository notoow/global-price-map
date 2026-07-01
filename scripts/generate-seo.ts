import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GeneratedData } from "../src/lib/schema.ts";
import { SITE, absoluteUrl } from "../src/lib/site.ts";

const DATA_FILE = path.resolve("src/data/generated/services.json");
const PUBLIC_DIR = path.resolve("public");

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function latestDate(dates: string[], fallback: string): string {
  return dates.filter(Boolean).sort().at(-1) ?? fallback;
}

function urlEntry(url: string, lastmod: string, priority: string): string {
  return [
    "  <url>",
    `    <loc>${xmlEscape(url)}</loc>`,
    `    <lastmod>${xmlEscape(lastmod)}</lastmod>`,
    "    <changefreq>daily</changefreq>",
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

const data = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as GeneratedData;
const homeLastmod = latestDate(
  data.services.flatMap((service) => service.offers.map((offer) => offer.checkedAt)),
  data.ratesAsOf,
);

const entries = [
  urlEntry(absoluteUrl("/"), homeLastmod, "1.0"),
  ...data.services.map((service) =>
    urlEntry(
      absoluteUrl(`/services/${service.id}/`),
      latestDate(service.offers.map((offer) => offer.checkedAt), data.ratesAsOf),
      "0.8",
    ),
  ),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: ${SITE.basePath}/

Sitemap: ${absoluteUrl("/sitemap.xml")}
`;

mkdirSync(PUBLIC_DIR, { recursive: true });
writeFileSync(path.join(PUBLIC_DIR, "sitemap.xml"), sitemap, "utf-8");
writeFileSync(path.join(PUBLIC_DIR, "robots.txt"), robots, "utf-8");

console.log(`✅ SEO 파일 생성 완료 — ${entries.length} URLs`);
