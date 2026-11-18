# 홈 상단 탐색 패널 재구성·배포 — 2026-11-05

완료. 큰 문구 제거 후 남은 빈 공간을 실제 탐색·참여·개설 동선으로 재구성하고, 앞서 요청한 배포까지 이어서 https://sliper.kr 에 반영했다.

## 디자인과 동작

- 큰 문구와 긴 홍보 설명을 제거했다. 화면을 차지하지 않는 접근성용 h1과 section 이름을 유지했다.
- PC에서는 모집 배너를 왼쪽에 넓게, 오른쪽에는 흰색 탐색 패널을 배치했다. 실제 공개 화면에서 배너·패널 높이가 동일하고 전체 상단 높이는 약 408px다.
- 번개 모임(/lightning), 이벤트 맵(/map), 기획 자료(/archive), 웹게임(/games) 바로가기 4개를 추가했다.
- 모임 둘러보기 버튼은 기존 모집글 필터를 적용하고 목록으로 이동한다. 모임 열기는 기존 로그인·글쓰기 권한 흐름을 사용한다. 짧은 호스트 가이드 링크도 제공한다.
- 모바일에서는 배너를 먼저 보여주고 그 아래에 바로가기 4개를 한 줄로 배치했다. 참여·개설 버튼을 두 줄 설명의 작은 카드로 정리했다. 320px에서도 가로 넘침이 없다.
- 기존 모집 건수만 재사용한다. 새 통계 조회·가짜 실시간 수치를 추가하지 않았다. 모집 수가 8개 조회 한도에 도달하면 '8개 이상'으로 표시한다.
- 기존 파란색·흰색·회색 톤, Pretendard, 배너 자동 전환·터치 동작과 호스트 카드 색상은 유지했다.

## 검증

TypeScript·비밀값 검사·수정 파일 포맷·관련 테스트 19개·diff 검사가 통과했다. Linux 운영 빌드와 서버 trace 134개 검사도 오류 0개다. standalone 5,348개 파일에 금지 파일·예상 밖 symlink가 없다.

배포 전 검증 서버 및 배포 후 공개 사이트에서 각각 기본 화면/메뉴 13개, 배너 3개, 새 탐색 패널 7개 등 총 23개 시나리오가 통과했다. 런타임 오류는 0건이다. 새 패널 검사는 1440·1024·768·393·320px 배치와 PC/모바일의 바로가기 4개·가이드·모집 필터·모임 개설 로그인 이동을 포함한다.

전체 백엔드 검사를 새로 반복한 것은 아니며 변경 범위에 맞춘 검증을 수행했다. 실제 Android/iPhone 원격 조작이 아니라 Chromium 모바일 viewport·터치 입력을 사용했다.

## 배포와 보존

현재 릴리스는 `/opt/sliper/releases/20261105-home-discovery-01`다. 기준 main 커밋은 `7cabc16c7c5ad93adad7a4c68016fa33ff7099c0`이며, 로컬 미커밋 UI 변경 3개 파일을 포함했다. 직전 운영본과 비교한 실제 변경은 src/app/site-refresh.css와 src/components/home-hero.tsx 두 파일이다. 이전에 배포한 hero-carousel.tsx의 모바일 터치 보완도 유지한다. 새 Git 커밋·푸시나 사용자 브랜치 변경은 하지 않았다.

패키지 SHA-256: `8f4078e5f31ff92e2cfed4efd64b4b8c32641ea460b760a45561f1ef7367afa9`. 694개 소스 파일 지문과 검증 결과를 운영 전환에 묶었다. 실패 시 직전 20261105-hero-carousel-02로 되돌리는 절차를 준비했고 정상 전환했다. 웹 서비스만 재시작했으며 타운·알림·영상·Redis·모니터·Nginx의 PID와 시작 시각, 별도 기존 사이트는 보존했다. DB·환경 설정·프록시 변경은 없다.

임시 검증 서버·unit·SSH 터널을 정리했다. 기존 릴리스 삭제는 수행하지 않았다.

```text
Filesystem       1B-blocks        Used   Available Use% Mounted on
/dev/xvda1     52573995008 23856398336 26016571392  48% /
```

실행·검증 근거는 .local/home-discovery-plan-20261105.json, home-discovery-stage-20261105.log, home-discovery-finalize-20261105.log, home-discovery-deploy-20261105.log, home-discovery-preview-layout-20261105/report.json, home-discovery-preview-carousel-20261105/report.json, home-discovery-preview-qa-20261105/report.json, home-discovery-public-layout-20261105/report.json, home-discovery-public-carousel-20261105/report.json, home-discovery-public-qa-20261105/report.json, home-discovery-complete-20261105.json에 보관했다. 운영 상태는 /opt/sliper/ops/home-discovery-status-20261105.json이다.
