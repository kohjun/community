# 실행 DB 읽기 전용 검증

`deploy:check`와 `/admin/readiness`는 계속 **설정 형식만** 검사합니다. `deploy:db-check`는 사용자가 명시해 실행하는 별도 CLI로, 실행용 `DATABASE_URL`에 실제 접속하여 카탈로그·권한·마이그레이션 원장을 읽습니다. 관리자 화면을 열었다고 원격 연결을 시도하지 않습니다.

## 사용

```powershell
npm run deploy:db-check -- --help
# 준비한 Supabase 전용 파일의 값만 사용
npm run deploy:db-check -- --env-file .env.supabase.local --json --strict
# 파일을 지정하지 않으면 Next 운영 환경변수 우선순위 사용
npm run deploy:db-check -- --json --strict
```

`.env.supabase.local`은 Git에 넣지 않는 로컬 설정 파일입니다. `--env-file`을 지정하면 dotenv로 해당 파일만 읽고, 기존 프로세스나 `.env`의 로컬 DB 값을 보충하지 않습니다. 파일이 없거나 `DATABASE_URL`이 비어 있으면 실패 결과만 반환하고 연결하지 않습니다. 비밀번호·비밀키·파일 내용을 채팅이나 검사 결과에 첨부하지 않습니다.

package 명령 끝의 `--` 구분자는 유지해야 합니다. Node가 자체 `--env-file` 옵션으로 먼저 파일을 읽는 일을 막고 이 CLI가 파일 읽기와 오류 비공개 처리를 담당하게 합니다. 직접 실행한다면 `node --import tsx scripts/deploy-db-check.ts -- --env-file .env.supabase.local --json` 형태로 사용합니다.

`--strict`는 FAIL이 있으면 종료 코드1, 잘못된 인자는2를 반환합니다. `--help`는 파일을 읽거나 DB에 접속하지 않습니다. JSON은 검사 시각·고정 검사 ID/상태/안내·집계만 포함합니다. 주소·호스트·역할명·원장 해시·환경변수·원문 DB 오류를 출력하지 않습니다.

## 확인하는 것

- `REPEATABLE READ READ ONLY` 트랜잭션의 실제 상태와 `pg_stat_ssl`의 현재 DB 백엔드 세션 암호화
- 현재 역할 및 그 역할이 속한 역할의 superuser·CREATEDB·CREATEROLE·복제 권한
- 현재 역할이 `sliper` 스키마·테이블·함수의 소유자이거나 소유자 역할의 구성원인지 여부
- 실행 역할의 스키마 USAGE, 스키마 CREATE 제한, 모든 앱 테이블의 SELECT/INSERT/UPDATE/DELETE와 함수 EXECUTE
- 모든 앱 테이블의 RLS 활성화와 현재 서버 인가 방식에 필요한 비소유자 신뢰 서버 역할의 실효 RLS 우회 접근
- PUBLIC·anon·authenticated의 스키마 사용/생성, 테이블 및 열 단위 DML, 민감 함수 EXECUTE 차단
- 현재 journal의 모든 SQL 파일 해시·적용 시각·순서와 `drizzle.__drizzle_migrations`의 정확한 일치
- 최신 snapshot의 앱 테이블 목록과 현재 DB 목록, 발행 SQL에서 선언된 앱 함수의 존재

현재 애플리케이션은 브라우저 역할에 DB 정책을 열지 않고 Next 서버의 서비스에서 회원별 인가를 수행합니다. 따라서 실행 역할은 소유자와 분리하면서 필요한 DML과 BYPASSRLS를 가진 **신뢰 서버 전용 역할**이어야 합니다. 이 역할의 접속 정보는 브라우저·일반 회원에게 제공하면 안 됩니다. 도구는 역할·권한을 만들거나 바꾸지 않습니다.

실행 역할에 migration 원장 SELECT 권한이 없으면 적용 상태를 확인할 수 없으므로 해당 항목은 FAIL입니다. 소유자 암호를 앱에 배포해 통과시키지 말고, 대상 DB 관리자가 `drizzle` 원장 읽기에 필요한 최소 권한을 별도로 검토해야 합니다. 이 검사는 `MIGRATION_DATABASE_URL`로 두 번째 접속을 하지 않습니다.

일반 SQL에서 호출할 수 없는 SECURITY INVOKER 트리거 함수와, 인자·본문·속성을 정확히 검증한 순수 `search_tags` 함수에만 공개 EXECUTE가 남은 경우는 정책 차이 WARN으로 표시합니다. 임의의 IMMUTABLE 함수를 안전하다고 가정하지 않으며, SECURITY DEFINER·직접 호출 가능한 민감 함수의 누출은 FAIL입니다. 저장소는 기본적으로 앱 함수의 공개 EXECUTE도 회수합니다.

## 실행 범위와 한계

실제 연결·카탈로그 조회는 하지만 앱 행을 조회하거나 INSERT/UPDATE/DELETE로 권한을 시험하지 않습니다. 마이그레이션·seed·역할 생성·권한 변경·정리·백업·Worker 시작·OAuth·Storage 요청도 하지 않습니다. 연결5초·문장8초·잠금2초·전체30초 한도를 사용하며 오류 원문은 숨깁니다. 읽지 못한 원장은 savepoint로 실패를 격리합니다.

사설/루프백/내부 주소는 `scope=local-diagnostic`, 공개 원격 주소는 `remote-database-readonly`, 설정이 없거나 해석할 수 없으면 `unconfigured`입니다. 로컬 진단은 운영 Supabase 검증 완료로 계산하지 않습니다. 원격은 URL의 TLS 설정뿐 아니라 현재 DB 세션의 TLS 관측도 필요합니다. `pg_stat_ssl`은 pooler 뒤 DB 세션의 관측이며 클라이언트→pooler 구간과 서비스 HTTPS까지 입증하지 않습니다.

모든 결과의 `releaseApproval`은 `not-performed`입니다. 이 도구가 통과해도 실제 두 회원의 OAuth·프로필 생성·상호 수정 차단, private Storage 저장/재생, 결제·환불, 실기기 푸시·QR, 부하·원격 복원·베타 검증은 별도로 남습니다. 모든 열·인덱스·트리거·함수 본문에 대한 전체 스키마 동등성 감사나 함수 코드 보안 감사를 대체하지 않습니다.

## 회귀 검사

`tests/deployment-database-audit.test.ts`는 전체 마이그레이션을 적용한 격리 PostgreSQL 호환 DB에서 실제 카탈로그 함수로 역할 분리·누락 DML·RLS 우회·상속 권한·열 단위 브라우저 접근·민감 함수·원장 변조/미적용/읽기 거부를 검사합니다. 별도 CLI 자식 프로세스에서 명시 파일 누락/빈값·로컬 환경 fallback 금지·도움말을 확인합니다.

`tests/deployment-database-audit.integration.ts`는 정확히 격리된 로컬 DB 주소에서만 실행됩니다. 실제 카탈로그를 읽는 단일 트랜잭션이며 역할·데이터를 만들지 않습니다. 전체 migration을 적용한 뒤 순차 실행해야 합니다. 로컬과 원격의 결과는 검증 기록에서 구분합니다.

## 2026-10-16 로컬 원장 차이 조사

새 실제 카탈로그 점검에서 기존 로컬 DB의 마이그레이션 **67개 중 2개**가 현재 파일 해시와 다름을 확인했습니다. 적용 시각과 전체 항목 수는 일치합니다. 대상은 `0007_participation_integrity`와 `0042_records_integrity`입니다. 이 조사에서 과거 SQL 파일·DB 원장·회원/행사 데이터는 수정하지 않았습니다.

현재 파일의 LF/CRLF·BOM 제거·마지막 개행 후보, Git HEAD·index와 보관된 이력 후보를 비교했지만 당시 적용된 바이트를 복원하지 못했습니다. 따라서 단순 줄바꿈 차이라고 단정하지 않으며, 원장 해시를 덮어써 검사를 통과시키지 않습니다.

기존 DB를 읽기 전용 트랜잭션으로 조회하여 현재 전체 마이그레이션을 새로 적용한 격리 DB와 대조했습니다. 해당 변경과 관련된 함수12개·트리거10개·제약228개·참가 중복 방지 인덱스1개의 현재 정의는 일치했습니다. 당시 전적 이력 backfill과 관련해 현재 전적의 이력 누락0건, 확인된 기존 크루 기여의 제작 경력 연결 누락0건을 관찰했습니다. 이는 현재 관련 상태의 대조이며 당시 SQL의 동일성을 입증하거나 모든 운영 데이터의 완전성을 보장하지 않습니다.

`deploy:db-check`의 원장 항목은 계속 **FAIL**입니다. 네이티브 회귀 검사는 독립적인 원장·파일 비교와 도구의 판정이 같은지를 검증하므로, 차이를 정확히 검출하면 테스트 자체는 통과합니다. 테스트 통과를 DB 출시 준비 통과로 계산하지 않습니다.

새 Supabase 환경에는 현재 발행된 전체 journal을 순서대로 적용하고 실제 실행 역할로 다시 검증해야 합니다. 기존 DB를 수리하려면 암호화 백업을 보존한 뒤 별도의 깨끗한 스키마 DB로 데이터를 이관하는 절차·정합 검사·기능 회귀·복구와 전환 계획이 필요합니다. 기존 원장을 임의 갱신하거나 과거 마이그레이션을 현재 데이터에 다시 실행하는 방식은 사용하지 않습니다.
