# Supabase 입력 파일과 연결 준비

2026-10-16 기준. 입력한 비밀값으로 Supabase DB와 비공개 Storage의 실제 연결을 확인했습니다. 마이그레이션67개·앱 테이블80개·기본 카테고리12개와 별도 실행 역할을 준비했습니다. 현재 사이트는 Supabase DB·Auth·Storage 환경으로 전환했습니다. 카카오·Google의 실제 로그인과 프로필 생성, 로그아웃·다시 로그인 흐름을 확인했습니다.

## 입력할 파일

`.env.supabase.local`은 Git에서 제외한 연결 준비 원본이며 마이그레이션 소유자 설정을 보관합니다. 필요한 실행 값은 현재 `.env`에 적용했습니다. 웹 환경의 `MIGRATION_DATABASE_URL`은 비워 소유자 연결을 전달하지 않습니다. 이전 로컬 `.env`는 Git 제외 백업으로 보관하며 경로는 `.local/supabase-activation.json`의 backup 항목에 기록했습니다. 채팅에 비밀값을 붙여넣지 않습니다.

| 키                                   | 입력할 값                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | 프로젝트의 publishable 키. 서버 비밀키를 넣지 않습니다.                                                             |
| DATABASE_URL                         | 별도 신뢰 서버 실행 역할의 PostgreSQL 연결 문자열. 실행 역할을 준비하지 않았다면 비워두고 역할 준비부터 진행합니다. |
| MIGRATION_DATABASE_URL               | 스키마 소유자의 direct 또는 session-pooler 마이그레이션 연결 문자열. 실행용 값과 구분합니다.                        |
| SUPABASE_STORAGE_SECRET_KEY          | 서버 전용 Storage secret 키                                                                                         |
| SUPABASE_STORAGE_BUCKET              | 실제 만든 비공개 버킷 이름                                                                                          |
| VISITOR_HASH_SECRET                  | 서버 전용의 안정된 32자 이상 난수                                                                                   |
| APP_ORIGIN                           | 실제 앱 주소. 공개 서비스는 HTTPS, PC에서 인증 개발을 확인할 때는 localhost/127.0.0.1 원본 주소                     |
| SLIPER_AUTH_MODE                     | Supabase 전환 시 supabase                                                                                           |
| LOCAL_DATABASE                       | Supabase 전환 시 0                                                                                                  |
| MEDIA_STORAGE_BACKEND                | Supabase 업로드 전환 시 supabase                                                                                    |

프로젝트 URL과 Storage URL은 이미 채웠습니다. PUSH_WORKER_MODE·REDIS_URL·VAPID 필드는 후속 운영 환경 준비용입니다. 실제 결제 제공자·도메인은 아직 미정입니다.

키의 종류는 [Supabase API 키 안내](https://supabase.com/docs/guides/getting-started/api-keys), 연결 문자열은 [공식 DB 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres)를 확인합니다. 연결 문자열의 호스트·포트·사용자명은 프로젝트 Connect 화면의 실제 값을 사용하며 임의로 조합하지 않습니다. 암호의 예약 문자는 URL 인코딩합니다.

## 값을 채운 다음 순서

1. 먼저 DB 실행 역할·소유자 분리와 대상 프로젝트를 확인합니다. 현재 앱은 Next 서버에서 회원별 인가를 수행하므로 실행 역할은 필요한 DML 및 RLS 접근을 갖는 서버 전용 역할이어야 합니다. 소유자 암호를 웹 앱에 배포해 검사를 우회하지 않습니다.
2. 준비한 파일만 지정해 읽기 전용 점검을 실행합니다. 빈 값이면 실패 결과를 내며 기존 로컬 DB로 대신 연결하지 않습니다.

```powershell
npm run deploy:db-check -- --env-file .env.supabase.local --json --strict
```

3. 대상 DB가 비어 있다면 전체 마이그레이션 적용이 별도 필요합니다. 위 명령은 마이그레이션·역할 생성·권한 변경을 수행하지 않습니다. 적용할 대상·역할·전체 SQL과 검증 결과를 확인한 뒤 진행합니다. 원격에 local-bootstrap·seed-demo·테스트 계정을 실행하지 않습니다.
4. 실제 앱 실행 환경에 설정을 반영하고 다시 빌드합니다. private Storage 저장/재생, 두 회원의 OAuth·프로필·수정 권한을 실제로 확인합니다. 기존 local 미디어는 설정 변경만으로 복사되지 않습니다.
5. 공개 HTTPS와 외부 결제·상시 Worker·실기기·복원·부하 검증으로 이어갑니다.

이 파일 준비나 DB 카탈로그 검사 통과를 실제 로그인·Storage·결제·출시 완료로 판단하지 않습니다. [DB 점검의 범위](PRODUCTION_DATABASE_AUDIT.md), [전체 연결 절차](PRODUCTION_INTEGRATION.md)를 함께 확인합니다.

## Drizzle Quickstart 반영

`drizzle-orm`·`drizzle-kit`·`postgres`는 설치되어 있으며 기존 `drizzle.config.ts`, `src/db/schema.ts`와 영역별 스키마, `src/db/connection.ts`를 사용합니다. 예제의 새 schema/index 파일로 기존 테이블을 덮어쓰지 않습니다. 연결 드라이버에는 transaction pooler를 위한 `prepare: false`가 이미 적용되어 있습니다.

사용자가 제공한 shared pooler 주소를 기준으로 `.env.supabase.local`의 `MIGRATION_DATABASE_URL`에 Session pooler 포트5432·TLS 설정과 `[YOUR-PASSWORD]` 입력 자리를 준비했습니다. 해당 자리에는 프로젝트 DB 비밀번호를 로컬에서 입력하고 예약 문자는 URL 인코딩합니다. 이미 사용자가 채운 연결 값은 이 준비 작업에서 덮어쓰지 않습니다. 앱의 `DATABASE_URL`은 별도 실행 역할이 준비된 뒤 설정합니다. 현재 로컬 `.env`는 유지합니다. 이후 실제 대상에 전체 마이그레이션을 적용하고 별도 실행 역할의 `DATABASE_URL`을 채웠습니다. 아래 실제 연결 결과를 확인합니다.

[공식 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres)는 shared pooler의 Session5432와 Transaction6543을 구분합니다. [Drizzle 안내](https://supabase.com/docs/guides/database/drizzle)도 참고합니다.

선택 Supabase Agent Skills 두 개(`supabase`, `supabase-postgres-best-practices`)를 Codex 사용자 스킬 폴더에 설치했습니다. 현재 연결 작업에 적용했습니다. 스킬 설치와 실제 DB·Storage 검증은 별도 작업입니다.

## 2026-10-16 실제 연결 결과

- journal의67개 마이그레이션을 파일별 트랜잭션으로 적용했습니다. 원장 해시·시각·순서는 모두 일치합니다. 기본 카테고리12개만 등록했으며 기존 로컬 데이터·회원·샘플 행사·미디어는 복사하지 않았습니다.
- 소유자와 분리한 서버 전용 실행 역할을 만들었습니다. 앱 스키마의 USAGE·DML·함수 실행과 RLS 우회를 준비하고 superuser·DB/역할 생성·복제·스키마 CREATE·소유자 역할 상속은 허용하지 않았습니다. 점검용 마이그레이션 원장에는 SELECT만 추가했습니다.
- 실제 실행 역할의 읽기 전용 검사는 **PASS12·WARN1·FAIL0**입니다. 앱→pooler는 필수 TLS 모드로 실제 쿼리를 완료했습니다. WARN은 pooler 이후 DB 백엔드 TLS 미관측이며 인증서·전체 통신 구간의 검증으로 확대하지 않습니다.
- 실제 앱 어댑터로 본문/프로필 이미지·영상 원본/결과를 저장하고 다시 읽어 내용 일치를 확인했습니다. 비회원 직접 URL·HEAD·Range 접근은 차단됐고 임시 객체는 모두 삭제했습니다. 회원별 HTTP 미디어 인가·영상 Worker 전체 과정의 클라우드 검증은 별도입니다.

앱 실행용 연결은 Transaction pooler6543, 마이그레이션용은 Session pooler5432로 분리했습니다. 실행 연결에는 `max_pipeline=1`을 지정하고 기존 드라이버의 `prepare:false`를 유지했습니다. 실제 트랜잭션 안의 동시 읽기12개와 카테고리 조회가 정확한 결과를 반환함을 확인했습니다.

`.env.supabase.local`에는 별도 실행 연결값과 아래 전환용 설정, 안정된 방문자 해시용 난수를 준비했습니다. 비밀값은 출력하거나 Git에 추가하지 않았습니다. 이 준비 파일은 자동 로딩되지 않으며, 이후 아래 실행 전환 단계에서 필요한 값을 `.env`에 적용했습니다. 기존 로컬 DB 데이터는 유지합니다.

```dotenv
SLIPER_AUTH_MODE=supabase
LOCAL_DATABASE=0
MEDIA_STORAGE_BACKEND=supabase
APP_ORIGIN=http://127.0.0.1:3000
```

## 다음 단계: 카카오·구글 로그인 활성화

최초 조사에서는 두 공급자가 비활성이었으나 사용자의 설정 후 Google·Kakao 활성화를 실제 조회로 확인했습니다. 아래는 설정 절차의 기록입니다. 공급자 ID/Secret은 Supabase 대시보드에 직접 입력합니다.

1. [Authentication → URL Configuration](https://supabase.com/dashboard/project/jzuxyvsnijuxosmepyar/auth/url-configuration): 현재 운영 Site URL은 `https://sliper.kr`, Redirect URLs에는 운영용 `https://sliper.kr/auth/callback`, `https://sliper.kr/auth/callback**`와 개발용 `http://127.0.0.1:3000/auth/callback`과 로컬 개발용 `http://127.0.0.1:3000/auth/callback**`을 추가합니다. 현재 코드의 `returnTo` 쿼리를 포함한 복귀 주소를 허용하는 설정입니다. localhost도 사용한다면 해당 원본과 callback을 각각 추가합니다.
2. [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/jzuxyvsnijuxosmepyar/auth/providers): Google·Kakao를 활성화하고 각 공급자의 ID/Secret을 입력합니다. 두 공급자 개발자 콘솔에 등록할 OAuth Redirect URI는 **`https://jzuxyvsnijuxosmepyar.supabase.co/auth/v1/callback`**입니다. Sliper의 `/auth/callback`과 구분합니다.
3. 공급자 설정 후 Supabase 앱 실행 환경으로 전환해 실제 두 계정의 가입·로그인·프로필 생성·상호 수정 차단과 파일 접근을 검증합니다. 현재 `.env`는 별도 백업 후 Supabase 실행 환경으로 전환했습니다. 공개 서비스와 모바일 와이파이 OAuth 테스트에는 별도 HTTPS 환경을 준비합니다.

공식 안내: [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao), [로그인 복귀 URL](https://supabase.com/docs/guides/auth/redirect-urls).

## 공급자별 입력 위치

Google은 Google Auth Platform의 Branding에서 앱 이름과 연락 이메일을 설정하고 Audience에서 외부 사용자를 선택한 뒤 테스트 사용자를 등록합니다. Clients에서 웹 애플리케이션 OAuth 클라이언트를 만들고 JavaScript origin에는 `http://127.0.0.1:3000`, Redirect URI에는 위 Supabase 콜백 주소를 넣습니다. 발급된 Client ID와 Client Secret을 Supabase Google 공급자에 저장합니다. [공식 Google 설정](https://supabase.com/docs/guides/auth/social-login/auth-google), [동의 화면과 테스트 사용자](https://developers.google.com/workspace/guides/configure-oauth-consent).

Kakao는 앱을 만들고 카카오 로그인 사용 설정을 ON으로 설정합니다. 앱 → 플랫폼 키 → REST API 키의 카카오 로그인 Redirect URI에 위 Supabase 콜백 주소를 등록합니다. 같은 REST API 키의 클라이언트 시크릿을 확인하고 활성화합니다. REST API 키가 Supabase의 Client ID이며 카카오 로그인 Client Secret이 Supabase의 Client Secret입니다. 프로필 닉네임·프로필 사진 동의항목을 설정하고 이메일 권한이 없는 개발 앱이면 Supabase Kakao의 Allow users without an email을 켭니다. [공식 Kakao 연동](https://supabase.com/docs/guides/auth/social-login/auth-kakao), [카카오 로그인 설정](https://developers.kakao.com/docs/ko/kakaologin/prerequisite).

설정 후 실제 앱의 Supabase 환경 전환·재시작과 로그인 검증은 별도 단계입니다. 현재 `.env.supabase.local`은 Next가 자동으로 읽지 않으므로 대시보드 설정만으로 현재 개발 로그인 방식이 바뀌지는 않습니다.

## OAuth 실행 전환과 KOE205 수정

- 실제 사이트는 `http://127.0.0.1:3000`에서 Supabase 모드로 실행합니다. 소셜 로그인 화면·홈·번개·아카이브가 HTTP200이며 로컬 테스트 로그인 경로는404입니다. 개발용 `dev:lan`은 로컬 DB 전용이므로 이 환경에서는 `npm run dev`를 사용합니다. 모바일 OAuth는 별도 HTTPS 환경에서 검증합니다.
- 웹과 같은 `.env`를 사용하는 영상 Worker와 알림함 Worker를 로컬 백그라운드로 시작했고 기동 및 오류 없음까지 확인했습니다. 운영 배포·재부팅 후 상시 실행·실기기 Web Push 완료를 뜻하지 않습니다.
- 카카오의 실제 계정 로그인에서 KOE205가 발생했습니다. 실제 요청에 Supabase 기본 `account_email`이 포함됨을 확인했고 Sliper 요청을 `profile_nickname profile_image`로 제한했습니다. Supabase Kakao의 Allow users without an email을 켜고 카카오 동의항목의 닉네임·사진을 설정한 후 실제 로그인 성공, 프로필 생성1건과 기본 정보 화면 이동을 확인했습니다.
- Supabase의 `scopes` 옵션은 Kakao 기본 권한에 추가되므로 이 경우 이메일을 제거하지 못합니다. 공급자별 `queryParams.scope`를 사용해 실제 외부 요청에서 이메일이 빠지는지 검증했습니다. Google의 email/profile 기본값·PKCE·HTTP-only 쿠키·고정 콜백·Origin 검사는 유지합니다.
- `npm run test:supabase-oauth`는 Supabase 모드의 PC loopback 서버에서만 실행하는 별도 실제 연결 검사입니다. 외부 Origin·미지원 공급자 차단, 임의 폼 scope/redirect_uri 무시, Kakao 최소 권한과 Google 기본 권한·PKCE를 확인하며 계정 입력·동의·회원 생성은 자동화하지 않습니다.2개 통과를 확인했고 인증/인가 기존 회귀33개도 통과했습니다.

이후 사용자가 Kakao 로그인·기본 정보 화면 이동, 로그아웃 후 Google 로그인 성공을 확인했습니다. 서버에서도 콜백2건의 정상 복귀·로그아웃 HTTP200·프로필2건 생성을 확인했습니다. 두 회원의 상호 수정 차단과 가입 정보 저장 이후 신청/미디어 전체 흐름의 클라우드 검증은 별도로 남습니다. 초기 Chrome 검사의 인증 화면 이동과 실제 계정 로그인 결과를 구분합니다.

최종 전환 검증: Kakao/Google 실제 로그인 성공(사용자 확인), 원격 프로필2건 생성·콜백2건 정상 복귀·로그아웃 HTTP200(서버 확인), OAuth 실제 연결 회귀2개·기존 인증/인가 회귀33개·타입·비밀값 검사 통과. 현재 실행 주소는 `http://127.0.0.1:3000`입니다.
