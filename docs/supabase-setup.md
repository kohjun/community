# Supabase 연결 준비

1단계 로컬 검증은 Supabase 계정 없이 실행할 수 있다. 실제 인증을 연결할 때 다음 설정이 필요하다.

## 프로젝트와 환경변수

1. Supabase 프로젝트를 만들거나 사용할 개발 프로젝트를 정한다.
2. 프로젝트 URL과 빈 키를 준비한 Git 제외 `.env.supabase.local`에 대상 연결 값을 입력한다. 이 파일은 현재 로컬 `.env`를 덮어쓰지 않는다. 실제 Supabase 전환 시 `LOCAL_DATABASE=0`, `SLIPER_AUTH_MODE=supabase`를 사용한다. [입력 파일 안내](SUPABASE_CONNECTION_PREPARATION.md)를 참고한다.
3. 프로젝트 Connect 화면에서 PostgreSQL 연결 문자열을 확인한다. 서버의 `DATABASE_URL`과 마이그레이션의 `MIGRATION_DATABASE_URL`을 구분한다. 마이그레이션에는 direct 또는 session-pooler 연결을 사용한다.
4. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 설정한다. DB 암호와 접속 문자열에는 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
5. `VISITOR_HASH_SECRET`에는 서버에서 생성한 최소 32자 난수를 설정하고 모든 서버 인스턴스에서 동일하게 유지한다.

`sliper` 스키마는 Data API에 노출하지 않는다. SQL Editor로 직접 테이블을 만든 경우와 달리 이 저장소의 마이그레이션이 RLS·권한·트리거를 함께 구성하므로 저장소의 모든 마이그레이션을 순서대로 적용한다. 원격에서는 `local-bootstrap`과 `seed-demo`를 실행하지 않는다.

## 실제 공급자에서 확인할 일

- Supabase의 카카오·구글 공급자 활성화 및 각 공급자의 OAuth 앱 설정
- 로컬/배포 주소의 리디렉션 허용 목록 설정
- 구현된 서버 쿠키 세션·콜백의 실제 공급자 왕복 확인
- 검증된 신규 회원의 프로필 최초 생성/조회 확인
- 두 실제 회원의 익명 글·댓글 소유권 분리 확인

세션·콜백·프로필 연결 코드는 구현되어 있지만 실제 프로젝트 공급자 로그인은 연결·검증하지 않았다. OAuth client secret은 공급자 설정에서 관리하며 커뮤니티 DB나 브라우저 응답으로 전달하지 않는다.

프로젝트 URL·공개키·DB 연결 설정이 준비되면 실제 마이그레이션과 인증 왕복 테스트를 수행할 수 있다. 비밀키나 DB 암호를 채팅으로 보내는 대신 로컬 `.env`에 입력한다.

## 이미지 저장소와 운영 설정 점검

private Supabase Storage 어댑터와 행별 local/supabase 저장 위치를 준비했다. 기존 로컬 파일은 자동 복사하지 않는다. `.env.example`의 저장소 필드와 `npm run deploy:check`를 사용하며 [실서비스 연결 절차](PRODUCTION_INTEGRATION.md)를 참고한다. 비밀키·DB 암호는 공개 환경변수에 넣지 않는다.

## 공식 안내

- [Supabase 데이터베이스 연결](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [카카오 로그인](https://supabase.com/docs/guides/auth/social-login/auth-kakao)
- [구글 로그인](https://supabase.com/docs/guides/auth/social-login/auth-google)
