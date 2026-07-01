import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const CACHE_PATH = path.resolve("data/.cache/rates.json");
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

function readCache(): CacheFile | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(data: CacheFile) {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

async function fetchLive(currencies: string[]): Promise<CacheFile> {
  const url = `${FRANKFURTER_URL}?base=KRW&symbols=${currencies.join(",")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Frankfurter API가 ${res.status}를 반환했어요`);
    }
    const json = (await res.json()) as { date: string; base: string; rates: Record<string, number> };
    return { date: json.date, base: "KRW", rates: json.rates };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * KRW 기준 환율을 가져온다. 라이브 호출이 실패하면(네트워크 차단, API 다운, 타임아웃)
 * 마지막으로 캐시된 값으로 폴백한다 — 단, 캐시에 필요한 통화가 전부 있을 때만.
 * 둘 다 안 되면 명확한 에러로 죽는다 (조용히 잘못된 가격을 만드는 것보다 낫다).
 */
export async function fetchRates(currencies: string[]): Promise<RatesResult> {
  const needed = [...new Set(currencies)].filter((c) => c !== "KRW");

  try {
    const live = await fetchLive(needed);
    const missing = needed.filter((c) => !(c in live.rates));
    if (missing.length > 0) {
      throw new Error(`Frankfurter 응답에 통화가 빠져 있어요: ${missing.join(", ")}`);
    }

    const cached = readCache();
    const merged: CacheFile = {
      date: live.date,
      base: "KRW",
      rates: { ...(cached?.rates ?? {}), ...live.rates },
    };
    writeCache(merged);

    console.log(`[fetch-rates] Frankfurter에서 환율 ${needed.length}개를 받아왔어요 (기준일 ${live.date})`);
    return { ...merged, source: "live" };
  } catch (err) {
    console.warn(`[fetch-rates] 라이브 호출 실패: ${(err as Error).message}`);
    const cached = readCache();
    const missing = cached ? needed.filter((c) => !(c in cached.rates)) : needed;

    if (!cached || missing.length > 0) {
      throw new Error(
        `환율을 가져올 수 없어요. 라이브 호출도 실패했고 캐시(${CACHE_PATH})에도 ` +
          `${missing.join(", ") || "데이터가"} 없어요.`,
      );
    }

    console.warn(`[fetch-rates] 캐시된 환율(기준일 ${cached.date})로 대체할게요`);
    return { ...cached, source: "cache" };
  }
}
