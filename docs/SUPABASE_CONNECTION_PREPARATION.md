# Supabase 입력 파일과 연결 준비

2026-10-16 기준. 프로젝트 URL을 받았고 비밀값은 사용자가 로컬에서 입력합니다. 원격 DB·Storage·OAuth에 아직 연결하거나 마이그레이션하지 않았습니다.

## 입력할 파일

프로젝트 루트의 `.env.supabase.local`에 제공한 프로젝트 URL을 채웠고 나머지는 빈 값으로 준비했습니다. 이 파일은 Git에서 제외되며 Next가 자동으로 읽는 파일 이름이 아니므로 현재 `.env`의 로컬 DB와 인증은 유지됩니다. 채팅에 비밀값을 붙여넣지 않습니다.

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

사용자가 제공한 shared pooler 주소를 기준으로 `.env.supabase.local`의 `MIGRATION_DATABASE_URL`에 Session pooler 포트5432·TLS 설정과 `[YOUR-PASSWORD]` 입력 자리를 준비했습니다. 해당 자리에는 프로젝트 DB 비밀번호를 로컬에서 입력하고 예약 문자는 URL 인코딩합니다. 이미 사용자가 채운 연결 값은 이 준비 작업에서 덮어쓰지 않습니다. 앱의 `DATABASE_URL`은 별도 실행 역할이 준비된 뒤 설정합니다. 현재 로컬 `.env`는 계속 유지하며 원격 마이그레이션·접속은 아직 하지 않았습니다.

[공식 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres)는 shared pooler의 Session5432와 Transaction6543을 구분합니다. [Drizzle 안내](https://supabase.com/docs/guides/database/drizzle)도 참고합니다.

선택 Supabase Agent Skills 두 개(`supabase`, `supabase-postgres-best-practices`)를 Codex 사용자 스킬 폴더에 설치했습니다. 다음 대화 턴부터 사용 가능합니다. 이 설치는 Supabase 프로젝트·MCP·DB 접속을 활성화하지 않습니다.
