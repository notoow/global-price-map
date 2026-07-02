import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { PriceFactSchema } from "../src/lib/schema.ts";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/KRW";
const CACHE_PATH = path.resolve("data/.cache/rates.json");
const RAW_DIR = path.resolve("data/raw");
const APP_STORE_FACTS_FILE = path.resolve("data/app-store/generated/price-facts.json");
const FETCH_TIMEOUT_MS = 8000;

export interface RatesResult {
  date: string;
  base: "KRW";
  rates: Record<string, number>; // currency -> "1 KRW = X <currency>"
  source: "live" | "cache";
}

interface CacheFile {
  date: string;
  base: "KRW";
  rates: Record<string, number>;
}

interface FrankfurterResponse {
  date: string;
  base: string;
  rates: Record<string, number>;
}

interface ExchangeRateApiResponse {
  result: string;
  time_last_update_utc?: string;
  base_code: string;
  rates: Record<string, number>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): CacheFile | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as CacheFile;
  } catch {
    return null;
  }
}

function writeCache(data: CacheFile) {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function collectManualCurrencies(): string[] {
  if (!existsSync(RAW_DIR)) return [];

  const currencies: string[] = [];
  const files = readdirSync(RAW_DIR).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));

  for (const file of files) {
    const raw = parse(readFileSync(path.join(RAW_DIR, file), "utf-8"));
    const result = PriceFactSchema.safeParse(raw);
    if (result.success) currencies.push(result.data.currency);
  }

  return currencies;
}

function collectAppStoreCurrencies(): string[] {
  if (!existsSync(APP_STORE_FACTS_FILE)) return [];

  try {
    const raw = JSON.parse(readFileSync(APP_STORE_FACTS_FILE, "utf-8")) as { facts?: unknown[] };
    const currencies: string[] = [];
    for (const fact of raw.facts ?? []) {
      const result = PriceFactSchema.safeParse(fact);
      if (result.success) currencies.push(result.data.currency);
    }
    return currencies;
  } catch {
    return [];
  }
}

function collectCurrenciesFromData(): string[] {
  return [...new Set([...collectManualCurrencies(), ...collectAppStoreCurrencies()])];
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFrankfurter(currencies: string[]): Promise<CacheFile> {
  if (currencies.length === 0) return { date: today(), base: "KRW", rates: {} };

  const url = `${FRANKFURTER_URL}?base=KRW&symbols=${currencies.join(",")}`;
  const json = await fetchJson<FrankfurterResponse>(url);
  return { date: json.date, base: "KRW", rates: json.rates ?? {} };
}

async function fetchExchangeRateApi(): Promise<CacheFile> {
  const json = await fetchJson<ExchangeRateApiResponse>(EXCHANGE_RATE_API_URL);
  if (json.result !== "success" || json.base_code !== "KRW") {
    throw new Error(`unexpected response from open.er-api.com: ${json.result}`);
  }

  const date = json.time_last_update_utc
    ? new Date(json.time_last_update_utc).toISOString().slice(0, 10)
    : today();

  return { date, base: "KRW", rates: json.rates ?? {} };
}

async function fetchLive(currencies: string[]): Promise<CacheFile> {
  const needed = [...new Set(currencies)].filter((currency) => currency !== "KRW");
  const rates: Record<string, number> = {};
  let date = today();

  try {
    const frankfurter = await fetchFrankfurter(needed);
    Object.assign(rates, frankfurter.rates);
    date = frankfurter.date;
    console.log(`[fetch-rates] Frankfurter returned ${Object.keys(frankfurter.rates).length} rates.`);
  } catch (err) {
    console.warn(`[fetch-rates] Frankfurter failed: ${(err as Error).message}`);
  }

  let missing = needed.filter((currency) => !(currency in rates));
  if (missing.length > 0) {
    try {
      const broadRates = await fetchExchangeRateApi();
      for (const currency of missing) {
        const rate = broadRates.rates[currency];
        if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
          rates[currency] = rate;
        }
      }
      date = broadRates.date;
      console.log(`[fetch-rates] open.er-api.com filled ${missing.length} requested currencies.`);
    } catch (err) {
      console.warn(`[fetch-rates] open.er-api.com failed: ${(err as Error).message}`);
    }
  }

  missing = needed.filter((currency) => !(currency in rates));
  if (missing.length > 0) {
    throw new Error(`missing exchange rates: ${missing.join(", ")}`);
  }

  return { date, base: "KRW", rates };
}

export async function fetchRates(currencies: string[]): Promise<RatesResult> {
  const needed = [...new Set(currencies)].filter((currency) => currency !== "KRW");

  try {
    const live = await fetchLive(needed);
    const cached = readCache();
    const merged: CacheFile = {
      date: live.date,
      base: "KRW",
      rates: { ...(cached?.rates ?? {}), ...live.rates },
    };

    writeCache(merged);
    console.log(`[fetch-rates] Saved ${Object.keys(live.rates).length} live rates as of ${live.date}.`);
    return { ...merged, source: "live" };
  } catch (err) {
    console.warn(`[fetch-rates] Live fetch failed: ${(err as Error).message}`);
    const cached = readCache();
    const missing = cached ? needed.filter((currency) => !(currency in cached.rates)) : needed;

    if (!cached || missing.length > 0) {
      throw new Error(
        `Could not load exchange rates. Missing from cache ${CACHE_PATH}: ${missing.join(", ") || "all"}`,
      );
    }

    console.warn(`[fetch-rates] Falling back to cached rates as of ${cached.date}.`);
    return { ...cached, source: "cache" };
  }
}

async function main() {
  const currencies = collectCurrenciesFromData();
  const result = await fetchRates(currencies);
  console.log(
    `[fetch-rates] Ready: ${currencies.length} currencies, ${result.source} rates as of ${result.date}.`,
  );
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((err) => {
    console.error(`[fetch-rates] Failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
