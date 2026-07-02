import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { BillingCycleSchema, PriceFactSchema, type PriceFact } from "../src/lib/schema.ts";

const CONFIG_PATH = path.resolve("data/app-store/services.yml");
const OUT_PATH = path.resolve("data/app-store/generated/price-facts.json");
const REQUEST_TIMEOUT_MS = 12000;
const CONCURRENCY = 4;

const AppStoreServiceSchema = z.object({
  service: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  appStoreId: z.union([z.string(), z.number()]).transform(String),
  appSlug: z.string().min(1),
  planName: z.string().min(1),
  planId: z.string().min(1),
  billingCycle: BillingCycleSchema,
  occurrence: z.number().int().positive().default(1),
  taxIncluded: z.boolean().default(true),
});

const AppStoreConfigSchema = z.object({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  services: z.array(AppStoreServiceSchema).min(1),
});

interface AppStoreCache {
  generatedAt: string;
  source: "ios_app_store";
  facts: PriceFact[];
  stats?: {
    fetched: number;
    reused: number;
    missing: number;
  };
}

interface InAppPurchase {
  name: string;
  priceLabel: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function keyOf(service: string, country: string): string {
  return `${service}:${country}`;
}

function readPreviousFacts(): Map<string, PriceFact> {
  if (!existsSync(OUT_PATH)) return new Map();
  try {
    const cache = JSON.parse(readFileSync(OUT_PATH, "utf-8")) as AppStoreCache;
    const result = new Map<string, PriceFact>();
    for (const fact of cache.facts ?? []) {
      const parsed = PriceFactSchema.safeParse(fact);
      if (parsed.success) result.set(keyOf(parsed.data.service, parsed.data.country), parsed.data);
    }
    return result;
  } catch {
    return new Map();
  }
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .trim();
}

function extractCurrency(html: string): string | null {
  return html.match(/"priceCurrency":"([A-Z]{3})"/)?.[1] ?? null;
}

function extractInAppPurchases(html: string): InAppPurchase[] {
  const purchases: InAppPurchase[] = [];
  const pattern =
    /<li class="svelte-1gyt6l2"><div class="text-pair[^>]*><span>(.*?)<\/span>\s*<span>(.*?)<\/span>/g;

  for (const match of html.matchAll(pattern)) {
    purchases.push({
      name: stripTags(match[1]),
      priceLabel: stripTags(match[2]),
    });
  }

  return purchases;
}

function normalizePlanName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectPurchase(purchases: InAppPurchase[], planName: string, occurrence: number): InAppPurchase | null {
  const target = normalizePlanName(planName);
  const matches = purchases.filter((purchase) => normalizePlanName(purchase.name) === target);
  return matches[occurrence - 1] ?? null;
}

function parsePrice(priceLabel: string): number {
  const lowerLabel = priceLabel.toLowerCase();
  const compactMultiplier = lowerLabel.includes("ribu")
    ? 1_000
    : lowerLabel.includes("juta") || /\bjt\b/.test(lowerLabel)
      ? 1_000_000
      : 1;
  const numeric = priceLabel.replace(/\s+/g, "").replace(/[^\d.,]/g, "");
  if (!numeric) throw new Error(`가격 숫자를 찾을 수 없어요: ${priceLabel}`);

  const lastDot = numeric.lastIndexOf(".");
  const lastComma = numeric.lastIndexOf(",");
  let normalized = numeric;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const grouping = decimal === "." ? "," : ".";
    normalized = numeric.replaceAll(grouping, "").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const digitsAfter = numeric.length - lastComma - 1;
    normalized =
      digitsAfter === 2 || compactMultiplier > 1
        ? numeric.replaceAll(".", "").replace(",", ".")
        : numeric.replaceAll(",", "");
  } else if (lastDot >= 0) {
    const digitsAfter = numeric.length - lastDot - 1;
    normalized =
      digitsAfter === 2 || compactMultiplier > 1
        ? numeric.replaceAll(",", "")
        : numeric.replaceAll(".", "");
  }

  const price = Number(normalized) * compactMultiplier;
  if (!Number.isFinite(price) || price <= 0) throw new Error(`가격 파싱 실패: ${priceLabel}`);
  return price;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  const config = AppStoreConfigSchema.parse(parse(readFileSync(CONFIG_PATH, "utf-8")));
  const previousFacts = readPreviousFacts();
  const checkedAt = today();
  const tasks = config.services.flatMap((service) =>
    config.countries.map((country) => ({ service, country })),
  );

  let fetched = 0;
  let reused = 0;
  let missing = 0;
  const facts = await mapLimit(tasks, CONCURRENCY, async ({ service, country }) => {
    const countryPath = country.toLowerCase();
    const sourceUrl = `https://apps.apple.com/${countryPath}/app/${service.appSlug}/id${service.appStoreId}`;

    try {
      const html = await fetchText(sourceUrl);
      const currency = extractCurrency(html);
      if (!currency) throw new Error("통화 코드를 찾지 못했어요");

      const purchase = selectPurchase(extractInAppPurchases(html), service.planName, service.occurrence);
      if (!purchase) throw new Error(`플랜을 찾지 못했어요: ${service.planName}`);

      const fact = PriceFactSchema.parse({
        service: service.service,
        country,
        currency,
        plans: [
          {
            id: service.planId,
            price: parsePrice(purchase.priceLabel),
            displayPrice: purchase.priceLabel,
            billingCycle: service.billingCycle,
            taxIncluded: service.taxIncluded,
          },
        ],
        sourceUrl,
        sourceType: "ios_app_store",
        sourceName: "iOS App Store",
        checkedAt,
      });
      fetched++;
      return fact;
    } catch (err) {
      const fallback = previousFacts.get(keyOf(service.service, country));
      if (fallback) {
        reused++;
        console.warn(`[app-store] ${service.service}-${country}: ${(err as Error).message}; 이전 캐시 재사용`);
        return fallback;
      }

      missing++;
      console.warn(`[app-store] ${service.service}-${country}: ${(err as Error).message}; 건너뜀`);
      return null;
    }
  });

  const output: AppStoreCache = {
    generatedAt: new Date().toISOString(),
    source: "ios_app_store",
    facts: facts.filter((fact): fact is PriceFact => Boolean(fact)).sort((a, b) =>
      a.service.localeCompare(b.service) || a.country.localeCompare(b.country),
    ),
    stats: { fetched, reused, missing },
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`✅ App Store 가격 수집 완료 — fetched ${fetched}, reused ${reused}, missing ${missing}`);
}

main().catch((err) => {
  console.error(`❌ fetch-app-store-prices 실패: ${(err as Error).message}`);
  process.exit(1);
});
