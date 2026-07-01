// @ts-check
import { defineConfig } from "astro/config";

// GitHub Pages 배포 설정
//   - 레포가 "username.github.io" (유저/오르그 루트 사이트)면:
//       site: "https://username.github.io", base: "/"
//   - 레포가 "username/global-price-map" 같은 프로젝트 사이트면:
//       site: "https://username.github.io", base: "/global-price-map"
// repo 이름이 정해지면 아래 두 값만 바꿔주세요. base가 실제 레포 이름과
// 다르면 GitHub Pages에 배포된 사이트에서 CSS/이미지 경로가 깨집니다.
export default defineConfig({
  site: "https://notoow.github.io",
  base: "/global-price-map",
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
});
