import { z } from "zod";

/**
 * data/raw/*.yml 한 파일 = "서비스 X가 국가 Y에서 얼마인지"에 대한 검증된 사실 1건.
 * 국가별로 파일을 쪼개는 이유: PR 하나 = 가격 변경 하나가 되어야 리뷰가 쉬움.
 */

export const BillingCycleSchema = z.enum(["monthly", "yearly"]);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

export const PriceSourceTypeSchema = z.enum([
  "manual",
  "official_web",
  "ios_app_store",
  "google_play",
]);
export type PriceSourceType = z.infer<typeof PriceSourceTypeSchema>;

export const PlanSchema = z.object({
  id: z.string().min(1, "plan id는 비어 있을 수 없어요"),
  price: z.number().positive("price는 0보다 커야 해요"),
  displayPrice: z.string().min(1).optional(),
  billingCycle: BillingCycleSchema,
  taxIncluded: z.boolean(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PriceFactSchema = z.object({
  service: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "service는 kebab-case 슬러그여야 해요 (예: youtube-premium)"),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "country는 ISO 3166-1 alpha-2 대문자 코드여야 해요 (예: KR)"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "currency는 ISO 4217 대문자 코드여야 해요 (예: KRW)"),
  plans: z.array(PlanSchema).min(1, "plans는 최소 1개 이상이어야 해요"),
  sourceUrl: z.url("sourceUrl은 유효한 URL이어야 해요"),
  sourceType: PriceSourceTypeSchema.default("manual"),
  sourceName: z.string().min(1).optional(),
  checkedAt: z.iso.date("checkedAt은 실제 존재하는 YYYY-MM-DD 날짜여야 해요"),
});
export type PriceFact = z.infer<typeof PriceFactSchema>;

/** data/services.yml — 서비스 카탈로그(거의 안 바뀌는 메타데이터). 가격 사실과 분리. */
export const ServiceMetaSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  plan: z.string().min(1),
});
export type ServiceMeta = z.infer<typeof ServiceMetaSchema>;
export const ServiceMetaListSchema = z.array(ServiceMetaSchema);

/** generate-data.ts가 만들어내는 최종 산출물의 타입. src/pages에서 그대로 import해서 씀. */
export interface CountryOffer {
  country: string;
  countryName: string;
  currency: string;
  currencySymbol: string;
  price: number;
  priceLabel: string;
  krwPrice: number;
  billingCycle: BillingCycle;
  taxIncluded: boolean;
  sourceUrl: string;
  sourceType: PriceSourceType;
  sourceName?: string;
  checkedAt: string;
  isBaseline: boolean; // country === 'KR'
}

export interface ServiceWithOffers extends ServiceMeta {
  offers: CountryOffer[]; // krwPrice 오름차순 정렬
}

export interface GeneratedData {
  generatedAt: string;
  ratesAsOf: string;
  services: ServiceWithOffers[];
}
