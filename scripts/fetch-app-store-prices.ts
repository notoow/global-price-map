import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { BillingCycleSchema, PriceFactSchema, type PriceFact } from "../src/lib/schema.ts";

const CONFIG_PATH = path.resolve("data/app-store/services.yml");
const OUT_PATH = path.resolve("data/app-store/generated/price-facts.json");
const REQUEST_TIMEOUT_MS = Number(process.env.APP_STORE_TIMEOUT_MS ?? 12000);
const CONCURRENCY = Number(process.env.APP_STORE_CONCURRENCY ?? 1);
const REQUEST_DELAY_MS = Number(process.env.APP_STORE_REQUEST_DELAY_MS ?? 700);
const MAX_ATTEMPTS = Number(process.env.APP_STORE_MAX_ATTEMPTS ?? 3);

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

type AppStoreService = z.infer<typeof AppStoreServiceSchema>;

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

function envList(name: string): Set<string> | null {
  const value = process.env[name];
  if (!value) return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
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
  if (!numeric) throw new Error(`Could not find a numeric price in: ${priceLabel}`);

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
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Could not parse price: ${priceLabel}`);
  return price;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 250));
    }

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

      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * attempt;
        lastError = new Error("HTTP 429");
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_ATTEMPTS) await sleep(1500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("Request failed");
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

function selectedServices(services: AppStoreService[]): AppStoreService[] {
  const selected = envList("APP_STORE_SERVICES");
  if (!selected) return services;
  return services.filter((service) => selected.has(service.service));
}

function selectedCountries(countries: string[]): string[] {
  const selected = envList("APP_STORE_COUNTRIES");
  if (!selected) return countries;
  return countries.filter((country) => selected.has(country));
}

async function main() {
  const config = AppStoreConfigSchema.parse(parse(readFileSync(CONFIG_PATH, "utf-8")));
  const previousFacts = readPreviousFacts();
  const checkedAt = today();
  const services = selectedServices(config.services);
  const countries = selectedCountries(config.countries);
  const selectedTaskKeys = new Set(services.flatMap((service) => countries.map((country) => keyOf(service.service, country))));
  const tasks = services.flatMap((service) => countries.map((country) => ({ service, country })));

  let fetched = 0;
  let reused = 0;
  let missing = 0;

  console.log(
    `[app-store] Fetching ${tasks.length} service-country pairs ` +
      `(services ${services.length}/${config.services.length}, countries ${countries.length}/${config.countries.length}, concurrency ${CONCURRENCY}).`,
  );

  const facts = await mapLimit(tasks, CONCURRENCY, async ({ service, country }) => {
    const countryPath = country.toLowerCase();
    const sourceUrl = `https://apps.apple.com/${countryPath}/app/${service.appSlug}/id${service.appStoreId}`;

    try {
      const html = await fetchText(sourceUrl);
      const currency = extractCurrency(html);
      if (!currency) throw new Error("Could not find currency code");

      const purchase = selectPurchase(extractInAppPurchases(html), service.planName, service.occurrence);
      if (!purchase) throw new Error(`Could not find plan: ${service.planName}`);

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
        console.warn(`[app-store] ${service.service}-${country}: ${(err as Error).message}; reused previous cache.`);
        return fallback;
      }

      missing++;
      console.warn(`[app-store] ${service.service}-${country}: ${(err as Error).message}; skipped.`);
      return null;
    }
  });

  const nextFacts = new Map(previousFacts);
  if (process.env.APP_STORE_SERVICES || process.env.APP_STORE_COUNTRIES) {
    for (const key of selectedTaskKeys) nextFacts.delete(key);
  } else {
    nextFacts.clear();
  }

  for (const fact of facts) {
    if (fact) nextFacts.set(keyOf(fact.service, fact.country), fact);
  }

  const output: AppStoreCache = {
    generatedAt: new Date().toISOString(),
    source: "ios_app_store",
    facts: [...nextFacts.values()].sort((a, b) => a.service.localeCompare(b.service) || a.country.localeCompare(b.country)),
    stats: { fetched, reused, missing },
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`[app-store] Done: fetched ${fetched}, reused ${reused}, missing ${missing}.`);
}

main().catch((err) => {
  console.error(`[app-store] Failed: ${(err as Error).message}`);
  process.exit(1);
});
