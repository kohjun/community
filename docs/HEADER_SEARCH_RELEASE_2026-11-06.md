# 헤더 검색·워드마크 운영 반영 — 2026-11-06

- 운영 릴리스: `20261106-main-9945795-01`
- 소스 커밋: `99457951f33e8cbd37c9af4a88e7413b6f84bcef` (`origin/main`, 변경 커밋 `0d4cc21` 병합)
- 직전 릴리스: `20261106-main-ecac4af-01` (롤백용으로 유지)
- 푸시된 Git 커밋을 별도로 추출해 698개 허용 소스 파일을 패키징했다. 직전 릴리스와 UI 3개 파일 및 Next.js 생성 타입 경로만 다른 것을 확인했다. DB·타운·알림·영상·의존성 변경은 없다.

## 검사와 배포

- 관련 테스트 22개, 타입 검사, 변경 파일 Prettier 및 비밀정보 검사 통과. 전체 테스트는 이번에 다시 실행하지 않았다.
- Linux 운영 빌드 및 서버 추적 검사를 통과했다. standalone 5,693개 파일에 금지 파일·예상 밖 링크가 없었다.
- 운영 미리보기와 공개 주소의 홈·이야기 페이지에서 각각 7개 너비(320/359/360/393/720/721/1440px), 14개 사례를 검사했다. 워드마크, 검색 열기·포커스·입력·Enter·지우기·닫기, 가로 넘침과 브라우저 오류를 확인했다. PC는 검색창이 기본 표시된다.
- 미리보기에서 기존 홈 역할 전환·카테고리·게임 찜 필터의 4개 너비, 8개 회귀 사례도 통과했다. 변경 API는 검사 중 차단했다. 실제 휴대폰·로그인 회원 검증은 별도다.
- 홈·이야기·번개·아카이브·지도·게임·플레이어·마이페이지와 운영/웹/타운 health 등 11개 경로에서 HTTP 200을 확인했다. 웹만 교체하고 타운·알림·영상·Redis·감시·Nginx 프로세스와 기존 별도 서비스는 유지했다. 임시 미리보기와 SSH 전달 연결은 종료했다.

근거: `.local/deploy-header-search-qa/report.json`, `.local/deploy-header-search-production-qa/report.json`, `.local/deploy-main-994-regression-preview/report.json`, `.local/deploy-main-994-stage.sh`, `.local/deploy-main-994-finalize.sh`, `.local/deploy-main-994-switch.sh`.
