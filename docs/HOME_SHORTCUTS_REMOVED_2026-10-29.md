# 홈 바로가기 제거 — 2026-10-29

사용자 요청에 따라 홈페이지의 모임 찾기·이야기 나누기·기획 자료 찾기 세 바로가기 묶음을 제거했다. 상단 메뉴와 모바일 카테고리 13개는 유지한다. 광고 다음 카테고리/모집 콘텐츠로 이어진다.

- 운영 릴리스: `20261029-home-shortcuts-01`, 이전 `20261029-launch-preparation-04`.
- 변경은 `src/components/sliper-community.tsx`의 해당 nav 제거와 미사용 Zap import 정리다. DB·인증·결제·신청 API는 변경하지 않았다.
- 타입 검사·Linux 프로덕션 빌드·122개 서버 trace 검사 통과. standalone 3,407개 파일의 금지 파일과 예상 외 링크는 0개였다.
- 미리보기와 실제 sliper.kr 각각 25개 확인 통과. 1440/393/320px에서 바로가기 nav와 묶음이 DOM에 없고, 모바일 카테고리는 5·5·3줄이다. 가로 넘침은 없었다.
- 기존 문의/개인정보·약관/소개, 자료 3개 다운로드, 사이트맵·AdSense 확인 파일, 회원 화면 noindex, 공개 이미지 HEAD 200/조건부 GET 304, 비회원 API 401을 함께 확인했다.
- 운영 health·기존 다른 사이트 HTTP 200, 알림·영상 워커 PID 유지. 미리보기 서비스와 SSH 터널·브라우저는 종료했다.

기본 출시 준비는 [결제 제외 개선](LAUNCH_OPERATIONS_SETUP_2026-10-29.md)을 따른다. 전체 1,111개 검사는 그 기반에서 통과했으며 이번 단순 UI 삭제 후에는 타입·프로덕션 빌드·브라우저 검증을 수행했다. 새 DB 마이그레이션이나 실제 관리자 지정·사업자 신고·거래 연동은 하지 않았다.

검증 근거: Git 제외 `.local/home-shortcuts-qa-preview/report.json`, `home-shortcuts-qa-production/report.json`, `home-shortcuts-deploy.log`. 운영 소스 아카이브 SHA-256: `f651fc0e53cdf1aa3fedbf0d9e33b41ed8b2ed6c816d8274ddbdeae28f882be9`.
