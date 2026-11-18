# 최신 디자인·모바일 배포 — 2026-11-05

상태: 완료. 사용자 요청 “커밋 후에 푸쉬했는데 변경사항을 페이지에 적용”에 따라 원격 `origin/main`과 동일한 `a7f1bba88a53e1610d7e2f52fd7b633532c0b141`를 빌드해 https://sliper.kr 에 반영했다.

## 원인과 반영 범위

모바일에서 새 디자인이 보이지 않았던 주요 원인은 운영 서버가 `/opt/sliper/releases/20261102-sliper-town-05`를 계속 사용한 데 있다. 로컬의 새 디자인·모바일 반응형 변경은 당시 미배포 상태였다. 기존 서비스워커는 푸시 전용이며 페이지·API를 캐시하지 않는다.

최신 커밋에는 새 홈·헤더·푸터·모바일 탐색 메뉴, 홈 모임·인기 이야기·자료 모듈과 통일된 톤의 스타일이 포함된다. 작은 320px 화면에서 글 목록의 기본 grid 최소 너비로 약 17px 넘치던 부분은 `minmax(0, 1fr)`와 자식 `min-width: 0`으로 보정됐고, 이 변경도 사용자가 푸시한 최신 커밋에 포함됐음을 확인했다.

## 운영 결과

- 적용 커밋: `a7f1bba88a53e1610d7e2f52fd7b633532c0b141` — Merge pull request #1, tone-on-tone refresh.
- 현재 릴리스: `/opt/sliper/releases/20261105-mobile-refresh-03`.
- 웹 PID: `118646`. 웹 서비스만 새 버전으로 재시작했다.
- 타운·알림·영상·Redis·모니터·Nginx의 PID·서비스 시작 시각은 유지됐다. 기존 Contenido 사이트도 HTTP 200이다.
- DB 변경·마이그레이션·인증 설정 변경·비밀값 복사·Nginx 변경은 수행하지 않았다.
- 직전 정상 릴리스 `20261102-sliper-town-05`와 실제 알림/영상 워커의 `20261028-map-cleanup-01`, 기존 롤백본 `20261101-room-settings-01`을 보존했다.
- 임시 검증 서버·unit·SSH 터널은 종료·정리했다.
- 최종 디스크 사용률: 39%, 사용 가능한 공간 약 30.43GB. 새 릴리스의 생성용 컴파일 캐시만 빌드 완료 후 제외했고 기존 릴리스는 삭제하지 않았다.

## 검증

- 기존 기능 회귀 테스트 1,191개 통과, 주요 탐색·모바일·홈 도메인 테스트 12개 통과.
- 최신 커밋의 TypeScript 검사와 Linux 운영 빌드·postbuild 서버 trace 검사 통과. trace 134개에서 오류 0개, 워커 전용 의존성 0개.
- 비밀값 검사 통과. 새 standalone의 5,111개 파일에서 금지 파일·예상 밖 symlink 없음.
- 검증 서버와 실제 공개 사이트 각각 브라우저 13개 시나리오 통과, 런타임 오류 0건.
- 393px에서 홈·이야기·번개·아카이브·지도·웹게임·플레이어·마이페이지, 탐색 → 웹게임 → 홈 → 검색 상호작용을 확인했다.
- 320px 홈·아카이브와 720px·1440px 홈에서 가로 넘침이 없고 새 공통 헤더를 사용하는지 확인했다.
- 공개 주요 화면 8개와 운영·웹·타운 health 모두 HTTP 200이다.

실제 휴대폰을 원격 조작한 검사는 아니며 Chromium의 터치·모바일 viewport로 검증했다. 기존에 열려 있던 탭은 이전 클라이언트 코드가 메모리에 남아 있을 수 있으므로 한 번 새로고침하면 새 버전이 로드된다.

최신 커밋의 `site-refresh.css`, `participation-shell.tsx`, `post-detail-page.tsx`에는 Prettier 형식 경고가 있다. 커밋된 소스를 그대로 배포했으며, 형식 검사가 통과했다고 주장하지 않는다. 타입·빌드·브라우저 동작 검증은 통과했다.

근거: `.local/mobile-refresh-deploy-plan-20261105.json`, `mobile-refresh-stage-20261105.log`, `mobile-refresh-finalize-20261105.log`, `mobile-refresh-preview-qa-20261105/report.json`, `mobile-refresh-deploy-20261105.log`, `mobile-refresh-public-qa-20261105/report.json`, `mobile-refresh-complete-20261105.json`. 운영 상태는 `/opt/sliper/ops/mobile-refresh-status-20261105.json`에도 보관했다.
