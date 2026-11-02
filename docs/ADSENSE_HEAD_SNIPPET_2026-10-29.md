# AdSense 코드 스니펫 직접 삽입 — 2026-10-29

사용자가 제공한 Google 코드를 공통 head에 직접 삽입해 운영 반영했다. 메타 태그만 사용하는 단계에서 실제 async 스크립트가 초기 HTML에 포함되는 방식으로 변경했다.

```html
<script
  async
  src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7888129551635907"
  crossorigin="anonymous"
></script>
```

운영에서는 식별용 `id="sliper-adsense"`만 추가한다. 홈페이지·이야기·번개·아카이브·로그인·마이페이지·개인정보 안내의 초기 head에 정확히 1개 포함됨을 확인했다. 공통 라이브러리는 회원 화면에도 로드되지만 Sliper 수동 광고 단위를 해당 화면에서 만들거나 요청하지 않는다. 수동 광고 활성화는 별개이며 아직 false다. Google 계정의 자동 광고 설정·승인 상태를 코드로 확정하지 않는다.

- 운영 릴리스 `20261029-adsense-head-02`, 이전 `20261029-home-shortcuts-01`.
- `src/app/layout.tsx`와 `src/components/adsense-head-script.tsx`에서 head 코드 제공. 기존 AdSenseProvider의 Next Script 재삽입을 제거해 동일 스크립트를 중복 로드하지 않는다. 기존 경로/콘텐츠/가시성·광고 단위 요청 제한은 유지한다.
- 개인정보의 외부 코드 로딩 설명을 실제 범위와 맞췄다.
- 전체 검사 1,113개·타입·형식·비밀값·Drizzle 검사 통과. Linux 빌드와 서버 trace 122개 검사 통과. standalone 3,488개 파일의 금지 파일/예상 외 링크는 0개다.
- 미리보기와 실제 sliper.kr 각각 10개 확인 통과. 초기 head 7개 페이지, ads.txt, PC 1440/모바일 393px의 화면 이동 3회씩에서 라이브러리 1회 로드와 수동 광고 단위 0개를 확인했다. 브라우저 검사에서는 Google 코드를 무해한 stub으로 대체해 광고 트래픽을 만들지 않았다.
- 실제 공개 HTTP 응답에서도 홈페이지 200, head 스크립트 1개, async/crossorigin=anonymous와 정확한 게시자 URL을 확인했다.
- Sliper health 및 기존 다른 사이트 HTTP 200. 영상·알림 워커 PID와 설정 파일은 유지했다. 미리보기·터널·검사 브라우저는 종료했다.

Google 화면에서 **애드센스 코드 스니펫 → 코드를 삽입했습니다 → 확인**을 진행한다. 이후 검토 요청이 필요하면 해당 계정에서 진행한다. 사용자가 말한 검토 중 상태를 승인 완료로 바꾸어 해석하지 않는다.

원본: Git 제외 `.local/adsense-head-full-check.log`, `adsense-head-qa-preview/report.json`, `adsense-head-qa-production/report.json`, `adsense-head-deploy.log`. 소스 묶음 SHA-256: `dda233671a6fbb01084e83aea80320c6b3ae599c370c9ab6a9303ee70dcc189d`.
