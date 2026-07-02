export const COUNTRY_NAMES: Record<string, string> = {
  AR: "아르헨티나",
  AU: "호주",
  BR: "브라질",
  CA: "캐나다",
  DE: "독일",
  DK: "덴마크",
  EG: "이집트",
  FR: "프랑스",
  GB: "영국",
  HK: "홍콩",
  ID: "인도네시아",
  IN: "인도",
  JP: "일본",
  KR: "한국",
  MX: "멕시코",
  MY: "말레이시아",
  NG: "나이지리아",
  NZ: "뉴질랜드",
  PH: "필리핀",
  PK: "파키스탄",
  PL: "폴란드",
  SG: "싱가포르",
  TH: "태국",
  TR: "튀르키예",
  TW: "대만",
  US: "미국",
  ZA: "남아프리카공화국",
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  ARS: "ARS",
  AUD: "A$",
  BRL: "R$",
  CAD: "CA$",
  CHF: "CHF",
  CNY: "¥",
  DKK: "kr",
  EGP: "E£",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
  IDR: "Rp",
  INR: "₹",
  JPY: "¥",
  KRW: "₩",
  MXN: "MX$",
  MYR: "RM",
  NGN: "₦",
  NZD: "NZ$",
  PHP: "₱",
  PKR: "Rs",
  PLN: "zł",
  SGD: "S$",
  THB: "฿",
  TRY: "₺",
  TWD: "NT$",
  USD: "$",
  ZAR: "R",
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

export function formatLocalPrice(price: number, currency: string): string {
  const symbol = currencySymbol(currency);
  const formatted = price.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}
