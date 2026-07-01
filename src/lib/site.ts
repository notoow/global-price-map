export const SITE = {
  name: "서브링크",
  url: "https://notoow.github.io",
  basePath: "/global-price-map",
  locale: "ko_KR",
  language: "ko-KR",
  description:
    "YouTube Premium, Netflix, Spotify, Adobe Creative Cloud 등 구독 서비스의 국가별 가격을 KRW로 환산해 최저가 순위로 비교합니다.",
};

export const SITE_KEYWORDS = [
  "구독 서비스 가격 비교",
  "국가별 구독료",
  "유튜브 프리미엄 가격",
  "넷플릭스 가격 비교",
  "스포티파이 가격 비교",
  "어도비 가격 비교",
  "Adobe Creative Cloud 가격",
  "해외 결제 구독",
  "VPN 구독 가격",
];

export function withBase(path = "/"): string {
  const base = SITE.basePath === "/" ? "/" : `${SITE.basePath}/`;
  const cleanPath = path.replace(/^\/+/, "");
  return `${base}${cleanPath}`;
}

export function absoluteUrl(path = "/", origin = SITE.url): string {
  if (/^https?:\/\//.test(path)) return path;
  return new URL(withBase(path), origin).href;
}
