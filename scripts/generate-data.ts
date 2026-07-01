import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  PriceFactSchema,
  ServiceMetaListSchema,
  type PriceFact,
  type CountryOffer,
  type ServiceWithOffers,
  type GeneratedData,
} from "../src/lib/schema.ts";
import { countryName, currencySymbol, formatLocalPrice } from "../src/lib/locale-data.ts";
import { fetchRates } from "./fetch-rates.ts";

const RAW_DIR = path.resolve("data/raw");
const SERVICES_FILE = path.resolve("data/services.yml");
const OUT_FILE = path.resolve("src/data/generated/services.json");

function loadPriceFacts(): PriceFact[] {
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const facts: PriceFact[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(path.join(RAW_DIR, file), "utf-8"));
    const result = PriceFactSchema.safeParse(raw);
    if (!result.success) {
      // generate-data는 validate-data 이후에 도는 게 정상 흐름이지만, 단독 실행 시를
      // 대비해 여기서도 막는다 — 잘못된 가격으로 조용히 JSON을 만드는 것보다 낫다.
      console.error(`❌ ${file} 검증 실패:`);
      for (const issue of result.error.issues) {
        console.error(`   ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    facts.push(result.data);
  }
  return facts;
}

function toKrw(price: number, currency: string, rates: Record<string, number>): number {
  if (currency === "KRW") return Math.round(price);
  const rate = rates[currency]; // "1 KRW = rate 단위의 currency"
  if (!rate) {
    throw new Error(`환율에 ${currency}가 없어요 (rates 객체 확인 필요)`);
  }
  return Math.round(price / rate);
}

async function main() {
  const servicesRaw = parse(readFileSync(SERVICES_FILE, "utf-8"));
  const services = ServiceMetaListSchema.parse(servicesRaw);
  const facts = loadPriceFacts();

  const neededCurrencies = [...new Set(facts.map((f) => f.currency))];
  const ratesResult = await fetchRates(neededCurrencies);

  const factsByService = new Map<string, PriceFact[]>();
  for (const fact of facts) {
    const list = factsByService.get(fact.service) ?? [];
    list.push(fact);
    factsByService.set(fact.service, list);
  }

  const result: ServiceWithOffers[] = services.map((meta) => {
    const serviceFacts = factsByService.get(meta.id) ?? [];

    if (serviceFacts.length > 1) {
      const facts2 = serviceFacts[0].plans.length;
      void facts2; // no-op, plans.length checked per-fact below
    }

    const offers: CountryOffer[] = serviceFacts.map((fact) => {
      if (fact.plans.length > 1) {
        console.log(
          `[generate] ${fact.service}-${fact.country}: plans가 ${fact.plans.length}개라 ` +
            `첫 번째("${fact.plans[0].id}")만 비교에 사용해요`,
        );
      }
      const plan = fact.plans[0];
      return {
        country: fact.country,
        countryName: countryName(fact.country),
        currency: fact.currency,
        currencySymbol: currencySymbol(fact.currency),
        price: plan.price,
        priceLabel: formatLocalPrice(plan.price, fact.currency),
        krwPrice: toKrw(plan.price, fact.currency, ratesResult.rates),
        billingCycle: plan.billingCycle,
        taxIncluded: plan.taxIncluded,
        sourceUrl: fact.sourceUrl,
        checkedAt: fact.checkedAt,
        isBaseline: fact.country === "KR",
      };
    });

    offers.sort((a, b) => a.krwPrice - b.krwPrice);

    return { ...meta, offers };
  });

  const emptyServices = result.filter((s) => s.offers.length === 0);
  if (emptyServices.length > 0) {
    console.warn(
      `⚠️  가격 데이터가 하나도 없는 서비스: ${emptyServices.map((s) => s.id).join(", ")}`,
    );
  }

  const output: GeneratedData = {
    generatedAt: new Date().toISOString(),
    ratesAsOf: ratesResult.date,
    services: result,
  };

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(
    `✅ ${OUT_FILE.replace(process.cwd() + "/", "")} 생성 완료 — ` +
      `서비스 ${result.length}개, 환율 출처: ${ratesResult.source} (기준일 ${ratesResult.date})`,
  );
}

main().catch((err) => {
  console.error(`❌ generate-data 실패: ${err.message}`);
  process.exit(1);
});
