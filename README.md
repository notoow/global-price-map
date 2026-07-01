# 서브링크

구독 서비스를 가장 싸게 살 수 있는 나라를 한눈에 비교하는 정적 사이트.

- **호스팅**: GitHub Pages (서버비 0원)
- **자동화**: GitHub Actions — 환율 매일 갱신, 데이터 PR 검증, 자동 배포
- **비교 대상**: YouTube Premium, Netflix, Spotify, Apple Music, Disney+, Adobe Creative Cloud
- **스택**: Astro + TypeScript · Zod · pnpm · Frankfurter API

---

## 처음 설정 (한 번만)

### 1. `astro.config.mjs` 수정

```js
export default defineConfig({
  site: "https://notoow.github.io",
  base: "/global-price-map",
});
```

### 2. GitHub Pages 활성화

레포 → **Settings → Pages → Source** 를 `GitHub Actions` 로 변경.

### 3. 첫 배포

`main` 브랜치에 push하면 `build-pages.yml`이 자동으로 실행됩니다.

---

## 데이터 파이프라인

```
data/raw/*.yml          ← 공식 가격 수동 기입
  └─ validate-data.yml  ← push/PR 시 스키마 검증
  └─ update-rates.yml   ← 매일 KST 09:00 환율 갱신
  └─ build-pages.yml    ← main 변경 시 빌드 & 배포
        ↓
src/data/generated/services.json   ← 빌드 산출물 (커밋 대상)
        ↓
dist/                              ← GitHub Pages 배포 (커밋 X)
```

---

## 새 가격 데이터 추가하기

`data/raw/{service}-{country}.yml` 파일을 만들고 PR을 열면 됩니다.

```yaml
service: youtube-premium   # data/services.yml에 등록된 id
country: JP                # ISO 3166-1 alpha-2 (대문자)
currency: JPY              # ISO 4217 (대문자)
plans:
  - id: individual-monthly
    price: 1480
    billingCycle: monthly
    taxIncluded: true
sourceUrl: https://www.youtube.com/premium
checkedAt: 2026-07-01      # 직접 확인한 날짜
```

**주의**: `sourceUrl`에서 직접 가격을 재확인한 뒤 `checkedAt`을 갱신하세요.
PR 설명에 스크린샷을 첨부하면 리뷰가 훨씬 빠릅니다.

---

## 새 서비스 추가하기

`data/services.yml`에 항목을 추가한 뒤 `data/raw/{id}-{country}.yml` 파일들을 같이 PR하면 됩니다.

```yaml
- id: new-service
  name: New Service
  plan: 개인 · 월정액
```

---

## 로컬 개발

```bash
pnpm install
pnpm run validate       # 스키마 검증
pnpm run generate       # services.json + sitemap/robots 생성
pnpm run dev            # 개발 서버
```

환율 라이브 호출이 막혀 있어도 `data/.cache/rates.json` 캐시로 폴백되므로
인터넷 없이도 개발할 수 있습니다.

---

## 주의사항

- 실시간 서비스가 아닙니다. 환율은 하루 1회, 가격은 수동 갱신입니다.
- `data/.cache/rates.json`은 커밋해도 되고 안 해도 됩니다. 커밋하면 오프라인/Actions 네트워크 장애 시 폴백 값이 생깁니다.
- `src/data/generated/services.json`은 **반드시 커밋**하세요. 빌드 타임에 Astro가 이 파일을 읽어 정적 HTML을 만듭니다.
- GitHub 스케줄 워크플로는 공개 레포에서 60일간 활동이 없으면 비활성화될 수 있습니다. 주기적인 가격 데이터 PR이 자연스러운 활동 트리거가 됩니다.
