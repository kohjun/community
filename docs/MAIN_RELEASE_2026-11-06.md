# 푸시된 main 운영 배포 — 2026-11-06

- 운영 릴리스: `20261106-main-ecac4af-01`
- 소스 커밋: `ecac4afaf22877d32b53d4c02e02b8b93fddaba2` (`origin/main`)
- 직전 릴리스: `20261105-preference-ui-01` (롤백용으로 유지)
- 현재 작업 브랜치 `9483276`은 원격 main에 병합되어 있고 트리 내용이 동일했다. Git 커밋을 별도로 추출해 698개 허용 파일의 배포 패키지를 만들었다. 기존 미추적 파일은 포함하지 않았다.

## 변경 범위와 검증

- 직전 운영 소스와 비교해 기존 UI 파일 10개 변경, 5개 추가, 1개 삭제를 확인했다. 생성 타입 참조 파일의 개발/운영 경로 차이도 별도로 확인했다. DB 마이그레이션, 타운·알림·영상 워커 소스와 의존성 변경은 없었다.
- 비밀정보 검사, 타입 검사, 테스트 1,191개, Drizzle 메타데이터 검사 통과. 운영 Linux 빌드와 서버 추적 검사를 통과했고, standalone 5,613개 파일의 금지 파일·예상 밖 링크는 0개였다.
- 전체 `npm run check`는 기존 푸시 커밋에 포함된 8개 파일의 Prettier 서식 문제로 통과하지 못했다. 배포 커밋을 변경하지 않고 타입·테스트·DB 검사를 별도로 통과시켰다. 대상: `next.config.ts`, `src/app/layout.tsx`, `src/components/participation-shell.tsx`, `src/components/post-detail-page.tsx`, `src/components/site-footer.tsx`, `src/components/sliper-mark.tsx`, `src/domain/navigation.ts`, `src/lib/use-media-query.ts`.
- 미리보기와 공개 주소에서 각각 320·393·768·1440px 홈/웹게임 화면의 참가자·호스트 전환, 카테고리, 게임 찜·필터 및 가로 넘침을 검사했다. 각 8개 시나리오와 브라우저 오류 0건을 확인했다. 브라우저 변경 API는 차단했고 실제 회원 인증·실제 휴대폰 하드웨어는 이번 검사 범위가 아니다.
- 홈·이야기·번개·아카이브·지도·게임·플레이어·마이페이지와 운영/웹/타운 health 등 11개 경로에서 HTTP 200을 확인했다.
- 웹만 전환하고 타운·알림·영상·Redis·감시·Nginx 프로세스의 유지와 기존 별도 서비스 응답을 확인했다. DB·인증·환경 설정은 변경하지 않았다. 임시 미리보기와 SSH 전달 연결을 종료했다.

근거: `.local/deploy-main-ecac-qa/report.json`, `.local/deploy-main-ecac-production-qa/report.json`, `.local/deploy-main-ecac-stage.sh`, `.local/deploy-main-ecac-finalize.sh`, `.local/deploy-main-ecac-switch.sh`. 운영 서버의 릴리스에는 소스 커밋과 배포 패키지 해시가 기록돼 있다.
