import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  PriceFactSchema,
  ServiceMetaListSchema,
  type CountryOffer,
  type GeneratedData,
  type PriceFact,
  type ServiceWithOffers,
} from "../src/lib/schema.ts";
import { countryName, currencySymbol, formatLocalPrice } from "../src/lib/locale-data.ts";
import { fetchRates } from "./fetch-rates.ts";

const RAW_DIR = path.resolve("data/raw");
const SERVICES_FILE = path.resolve("data/services.yml");
const APP_STORE_FACTS_FILE = path.resolve("data/app-store/generated/price-facts.json");
const OUT_FILE = path.resolve("src/data/generated/services.json");

const GeneratedFactsSchema = z.object({
  facts: z.array(PriceFactSchema),
});

function reportIssues(label: string, issues: { path: PropertyKey[]; message: string }[]): never {
  console.error(`[generate] ${label} validation failed:`);
  for (const issue of issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

function loadManualPriceFacts(): PriceFact[] {
  const files = readdirSync(RAW_DIR).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
  const facts: PriceFact[] = [];

  for (const file of files) {
    const raw = parse(readFileSync(path.join(RAW_DIR, file), "utf-8"));
    const result = PriceFactSchema.safeParse(raw);
    if (!result.success) reportIssues(file, result.error.issues);
    facts.push(result.data);
  }

  return facts;
}

function loadAppStorePriceFacts(): PriceFact[] {
  if (!existsSync(APP_STORE_FACTS_FILE)) {
    console.warn(`[generate] ${APP_STORE_FACTS_FILE} not found; skipping App Store prices.`);
    return [];
  }

  const raw = JSON.parse(readFileSync(APP_STORE_FACTS_FILE, "utf-8"));
  const result = GeneratedFactsSchema.safeParse(raw);
  if (!result.success) reportIssues("App Store generated prices", result.error.issues);
  return result.data.facts;
}

function loadPriceFacts(): PriceFact[] {
  return [...loadManualPriceFacts(), ...loadAppStorePriceFacts()];
}

function toKrw(price: number, currency: string, rates: Record<string, number>): number {
  if (currency === "KRW") return Math.round(price);
  const rate = rates[currency];
  if (!rate) {
    throw new Error(`Missing exchange rate for ${currency}. Run pnpm run fetch-rates first.`);
  }
  return Math.round(price / rate);
}

async function main() {
  const servicesRaw = parse(readFileSync(SERVICES_FILE, "utf-8"));
  const services = ServiceMetaListSchema.parse(servicesRaw);
  const facts = loadPriceFacts();

  const neededCurrencies = [...new Set(facts.map((fact) => fact.currency))];
  const ratesResult = await fetchRates(neededCurrencies);

  const factsByService = new Map<string, PriceFact[]>();
  for (const fact of facts) {
    const list = factsByService.get(fact.service) ?? [];
    list.push(fact);
    factsByService.set(fact.service, list);
  }

  const result: ServiceWithOffers[] = services.map((meta) => {
    const serviceFacts = factsByService.get(meta.id) ?? [];

    const offers: CountryOffer[] = serviceFacts.map((fact) => {
      if (fact.plans.length > 1) {
        console.log(
          `[generate] ${fact.service}-${fact.country}: ${fact.plans.length} plans found; using ${fact.plans[0].id}.`,
        );
      }

      const plan = fact.plans[0];
      return {
        country: fact.country,
        countryName: countryName(fact.country),
        currency: fact.currency,
        currencySymbol: currencySymbol(fact.currency),
        price: plan.price,
        priceLabel: plan.displayPrice ?? formatLocalPrice(plan.price, fact.currency),
        krwPrice: toKrw(plan.price, fact.currency, ratesResult.rates),
        billingCycle: plan.billingCycle,
        taxIncluded: plan.taxIncluded,
        sourceUrl: fact.sourceUrl,
        sourceType: fact.sourceType,
        sourceName: fact.sourceName,
        checkedAt: fact.checkedAt,
        isBaseline: fact.country === "KR",
      };
    });

    offers.sort((a, b) => a.krwPrice - b.krwPrice);
    return { ...meta, offers };
  });

  const emptyServices = result.filter((service) => service.offers.length === 0);
  if (emptyServices.length > 0) {
    console.warn(`[generate] Services without price data: ${emptyServices.map((service) => service.id).join(", ")}`);
  }

  const output: GeneratedData = {
    generatedAt: new Date().toISOString(),
    ratesAsOf: ratesResult.date,
    services: result,
  };

  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(
    `[generate] Wrote ${OUT_FILE.replace(process.cwd() + path.sep, "")}: ` +
      `${result.length} services, rates ${ratesResult.source} as of ${ratesResult.date}.`,
  );
}

main().catch((err) => {
  console.error(`[generate] Failed: ${(err as Error).message}`);
  process.exit(1);
});
