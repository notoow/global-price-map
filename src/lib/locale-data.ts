/**
 * ISO 코드 -> 표시용 값 매핑.
 * data/raw/*.yml에는 country="IN" 처럼 코드만 들어가고, 화면에 보여줄 한글 이름/통화
 * 기호는 여기서 한 번만 관리한다. 새 국가를 추가하면 여기에도 한 줄 추가할 것.
 */

export const COUNTRY_NAMES: Record<string, string> = {
  KR: "한국",
  US: "미국",
  IN: "인도",
  PH: "필리핀",
  ID: "인도네시아",
  BR: "브라질",
  TR: "튀르키예",
  MX: "멕시코",
  JP: "일본",
  GB: "영국",
  CA: "캐나다",
  AU: "호주",
  ZA: "남아프리카공화국",
  MY: "말레이시아",
  TH: "태국",
  SG: "싱가포르",
  HK: "홍콩",
  PL: "폴란드",
  NZ: "뉴질랜드",
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  KRW: "₩",
  USD: "$",
  INR: "₹",
  PHP: "₱",
  IDR: "Rp",
  BRL: "R$",
  TRY: "₺",
  MXN: "MX$",
  JPY: "¥",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  ZAR: "R",
  MYR: "RM",
  THB: "฿",
  SGD: "S$",
  HKD: "HK$",
  PLN: "zł",
  NZD: "NZ$",
  EUR: "€",
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** "14900" + "KRW" -> "₩14,900", "139" + "MXN" -> "MX$139" 같은 식의 현지 표기 */
export function formatLocalPrice(price: number, currency: string): string {
  const symbol = currencySymbol(currency);
  const formatted = price.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}
