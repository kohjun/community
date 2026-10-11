# 커뮤니티 공개 전 기반 — 2026-10-04

## 이번 구현

- Supabase Auth 카카오·Google OAuth(PKCE), 서버 검증, Next.js 16 Proxy의 쿠키 갱신, 로그아웃.
- 기존 로컬 테스트 로그인을 유지하며 클라우드 인증과 서로 배타적으로 선택.
- 글·댓글·장소·플레이어 신고, 본인 신고 진행 상태, 익명 사용자 차단과 차단 해제.
- 관리자/검토자 권한, 신고 처리·콘텐츠 숨김/복원·경고·기간제 이용 제한, 관리자 제한 해제.
- 운영 조치는 사유와 담당자·시각을 DB에 기록. 제재 취소도 기존 이력을 삭제하지 않고 추가 기록.
- 신고 당시 사본은 운영자 전용. 사용자 응답에 인증 ID·신고자 ID·익명 작성자의 공개 ID를 포함하지 않음.
- 숨김은 별도 테이블로 적용. 원문을 삭제하지 않으며 기존 확정 참가자의 공지방·환불 흐름을 유지.
- 새 사이트 신청/외부 결제 확인 요청은 숨겨진 모집글에서 차단. 이미 들어온 외부 결제는 정원/결제 검증 후 기존 프로세스로 처리.
- 차단은 게시판 글/댓글 및 지도 목록에 적용. 행사 공지방의 필수 공지에는 적용하지 않음.
- 도움말, 이용규칙, 개인정보 정보 이용 안내, 환불 안내, 문의 접수·운영자 답변.
- 계정 탈퇴: 진행 중 행사/신청을 보호하고 프로필 연락처·사진 파일/연결·기기 구독을 제거한 뒤 계정 이용을 차단.
- 글 20회/시간, 댓글 60회/시간, 이미지 업로드 20회/시간, 신고 10회/시간, 문의 5회/시간. PostgreSQL 원자적 upsert로 여러 서버/동시 요청에 공통 적용. Redis 미사용.

## 화면

- /admin — 신고함, 문의함, 처리 이력. 운영 권한 검사.
- /settings/account — 내 계정 상태, 신고 내역, 사용자 차단, 회원 탈퇴.
- /support — 문의 접수·처리 상태·답변.
- /help — 첫 방문/신청/개최/알림 안내.
- /policies/community, /policies/privacy, /policies/refunds.

## 정식 로그인 연결

코드는 준비되어 있지만 실제 프로젝트 인증 정보와 OAuth 공급자 설정이 없으면 외부 로그인은 활성화되지 않습니다.
현재 로컬 PostgreSQL의 auth.users는 개발용 회원 참조 테이블이며 Supabase Auth 서버가 아닙니다. 로컬 DB에 클라우드 회원을 임의로 복제하지 않습니다.

1. Supabase 프로젝트의 PostgreSQL을 DATABASE_URL에, 마이그레이션 소유자 연결을 MIGRATION_DATABASE_URL에 설정합니다.
2. Supabase 프로젝트 URL과 publishable key를 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY에 설정합니다. service_role/secret key를 넣지 않습니다.
3. SLIPER_AUTH_MODE=supabase, LOCAL_DATABASE=0, APP_ORIGIN=https://실제서비스주소 를 설정합니다. 개발 PC 테스트는 http://localhost:3000도 허용하나 휴대폰 푸시는 HTTPS가 필요합니다.
4. Supabase Authentication → URL Configuration에서 Site URL을 APP_ORIGIN으로 설정하고 해당 주소의 /auth/callback을 Redirect URL 허용 목록에 등록합니다. /auth/callback?returnTo=... 도 허용하도록 callback 뒤 쿼리를 지원하는 허용 패턴을 정확한 사이트 경로로 등록합니다. 운영 환경 전체 도메인을 무분별하게 허용하지 않습니다.
5. Supabase Authentication → Providers에서 Google과 Kakao를 활성화합니다.
6. Google 웹 OAuth 앱과 Kakao 로그인 앱의 공급자 Redirect URI에는 Supabase가 제시하는 https://프로젝트.supabase.co/auth/v1/callback을 등록합니다. Sliper의 /auth/callback과 공급자용 callback은 다릅니다.
7. 각 공급자 Client ID/Secret은 Supabase Dashboard의 해당 공급자 설정에만 입력합니다.
8. npm run db:migrate, npm run db:seed 후 서버를 재시작합니다. 샘플 회원 seed:demo나 로컬 DB bootstrap을 운영 DB에 실행하지 않습니다.
9. 새 계정 2개로 로그인 → 프로필 입력 → 글/댓글 → 신청 → 로그아웃 → 다시 로그인과 권한 분리를 확인합니다.

공식 자료:

- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/social-login/auth-kakao
- https://supabase.com/docs/guides/auth/redirect-urls

## 운영 권한

- 개발 환경: npm run staff:local 로 격리된 로컬 DB의 기존 개발/테스트 계정에만 관리자 권한을 부여합니다.
- 운영 환경: npm run staff:grant -- --public-id 공개플레이어ID --role admin (검토 담당자는 moderator).
- 이 스크립트는 스키마 소유자 DB 연결을 사용합니다. 서버 배포자가 직접 실행하고, 공개 HTTP API로 권한을 부여하지 않습니다.
- OAuth metadata, 닉네임, 이메일 값으로 운영 권한을 판단하지 않습니다.
- moderator: 신고/문의 검토와 답변, 숨김/복원/경고/기간제 제한.
- admin: 위 권한과 기간제 제한 해제.
- 운영자 계정은 신고 화면에서 다른 운영자에게 제재하거나 자신이 탈퇴할 수 없습니다. 권한 이전/회수는 소유자 DB에서 처리합니다.
- 안내·정책 페이지는 서비스 동작 설명과 기본 운영 기준입니다. 공개 전 운영 주체, 담당 연락처, 실제 보관/파기 기간, 외부 제공·위탁 항목과 주최자 취소/일정 변경 처리 기준을 확정해야 합니다. 확정되지 않은 회사·연락처나 법적 보관 기간을 임의로 넣지 않았습니다.

## 탈퇴의 범위와 후속 운영

- 프로필의 연락처·기본정보, 프로필 사진 파일/메타데이터, Web Push 구독을 제거하고 closed 계정의 접근을 차단합니다. 글/댓글·결제 금액/처리 이력은 남습니다. 기존 신청서에 보존한 연락처와 답변은 변경 방지 규칙이 적용된 행사 기록이므로 이 단계에서는 삭제하지 않습니다.
- Supabase Auth의 회원 자체 삭제/공급자 연결 해제, 거래 관련 보관 및 정기 파기는 운영 정책에 맞춘 별도 후속 작업입니다. auth.users를 직접 삭제하면 연관 데이터가 cascade되거나 결제 FK로 차단될 수 있으므로 임의 삭제하지 않습니다.
- 현재 첨부 이미지와 프로필 사진은 기본 local이며 private Supabase Storage 어댑터도 준비되어 있습니다. 운영 전 오브젝트 스토리지 이전·미사용 파일 정리·백업 복구·외부 결제 실연동 검증이 필요합니다.
- 문의는 접수/답변 기록이며 외부 결제/환불을 자동 실행하지 않습니다. 운영자가 외부 주문·실제 환불을 확인합니다.
- 사진/문의 정보에 개인정보가 포함되면 신고/문의로 삭제 요청을 처리합니다.

## 검증

- 단위/DB 테스트 316개 통과: 익명 정보 비공개, 신고 중복, 권한·기간제 제한, 숨김/복원, 차단, 문의, 동시 요청 제한, 진행 중 행사와 신청서 보존.
- HTTP 통합 검사: 신고 등록/중복·운영자 큐·숨김/복원·익명 차단/해제·문의 답변·로그아웃·미인증/다른 출처 요청 차단 통과.
- `npm run test:safety-api`: 로컬 서버와 `npm run staff:local` 준비 후 실행. 격리된 개발 DB만 허용하며 생성한 임시 글·회원·문의·조치 기록은 정리합니다.
- 실제 Supabase 공급자 로그인은 프로젝트 설정 후 별도 검증이 필요합니다.

## 다음 우선순위 진행 상황

1. 결제/참가 대사·검토 메모와 주최자 취소·일정 변경 구현 완료. [행사 변경·알림·전액 환불 검토](EVENT_LIFECYCLE.md)를 참고하세요. 시작 후 예외 취소·사고 대응은 별도 운영 절차가 남아 있습니다.
2. QR 체크인·행사 종료·참가 인증 후기 및 행사/공개 호스트/템플릿 연결 구현 완료. [행사 운영 안내](EVENT_OPERATIONS.md)를 참고하세요.
3. 관심사·호스트 구독과 통합 알림함·행사 리마인더 구현 완료. [구독·알림 흐름과 실행 방법](ENGAGEMENT_AND_NOTIFICATIONS.md)을 참고하세요.
4. 글 상세 주소·공유/OG·통합 검색 구현 완료.
5. 지속적 크루·QR 참가 기록 기반 기여 보상 구현 완료. [글·검색·크루](SHARING_SEARCH_AND_CREWS.md)를 참고하세요.
6. private Storage 어댑터·환경변수 점검 준비 완료. 실제 공급자 연결은 [운영 준비](PRODUCTION_INTEGRATION.md) 절차에 따라 검증해야 합니다.
