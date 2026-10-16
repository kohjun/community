# 실서비스 연결 준비와 설정 점검

2026-10-16 기준. 실제 외부 연동과 로컬 검증을 구분합니다.

현재는 로컬 기능 개발 상태다. Supabase 프로젝트 URL은 준비되어 별도의 Git 제외 입력 파일을 만들었고 비밀값 입력을 기다리고 있다. 결제 플랫폼·공개 도메인은 아직 준비 전이며 실제 원격 연결·회원 인증·결제·배포는 활성화하지 않았다.

## 먼저 확인할 명령

```powershell
npm run deploy:check
npm run deploy:check -- --json
npm run deploy:check -- --strict
```

Next.js의 **운영 환경변수 우선순위**(.env.production.local → .env.local → .env.production → .env, 기존 프로세스 변수가 우선)를 사용한다. 기본 명령은 보고만 하고, --strict는 FAIL 항목이 하나라도 있으면 종료 코드 1을 반환한다. 로컬 설정으로 실행하면 개발 인증·HTTP·로컬 DB 등의 FAIL은 예상된 결과다.

이 명령은 키·비밀번호·접속 주소를 출력하지 않고 원격에 접속하지 않는다. PASS는 설정 형식 확인이며 서비스 연결 성공을 뜻하지 않는다. 결제·외부 자동 승인·기기 푸시가 비어 있으면 미연동 WARN으로 표시하고, 일부만 채운 잘못된 설정은 FAIL로 표시한다. DB 역할의 실제 RLS/테이블/함수 권한과 private 버킷은 실제 연결 단계에서 별도 확인해야 한다.

활성 관리자는 `/admin/readiness`와 `GET /api/safety/admin/readiness`에서 같은 정적 정책의 결과를 확인할 수 있다. 화면은 실행 중인 서버 환경, CLI는 위 운영 환경변수 우선순위를 검사하므로 서로 다른 환경을 실행하면 결과도 달라질 수 있다. 조회로 설정·DB·파일을 변경하거나 공급자에 연결하지 않으며, 설정값·비밀키·원문 오류를 반환하지 않는다. [관리자 준비 점검의 상태·한계·다음 순서](RELEASE_READINESS.md)를 참고한다.

## 연결 순서

1. **개발 Supabase**: .env.example 기준으로 프로젝트 URL·publishable key와 PostgreSQL 주소를 대상 환경에 입력한다. 인증 공개키는 `sb_publishable_` 형식 또는 기존 `anon` JWT를 사용하고, `sb_secret_`·`service_role`·임의 문자열·공백 포함 값은 사용할 수 없다. JWT 서명의 진위는 Supabase가 검증하며 정적 검사는 실제 로그인 성공을 보장하지 않는다. LOCAL_DATABASE=0, SLIPER_AUTH_MODE=supabase, APP_ORIGIN=https://실제서비스주소, SLIPER_LAN_HOST는 비운다. NEXT_PUBLIC_ 값은 빌드 시 고정되므로 설정 후 다시 빌드한다.
2. **DB**: 마이그레이션 소유자의 direct/session 연결로 `0000`부터 `0066_event_private_contacts`까지 journal의 전체 67개 항목을 순서대로 적용하고 카테고리 seed를 준비한다. 현재 애플리케이션 `sliper` 스키마는 80개 테이블이다. 이전 로컬 복원에서 대조한 81개는 당시 앱 79개와 인증·마이그레이션 관리 테이블을 포함한 수다. 신규 연락처 테이블 추가 이후의 전체 복원을 그 과거 결과로 대신하지 않는다. 운영에 local-bootstrap/seed-demo/테스트 계정을 실행하지 않는다. DATABASE_URL에는 실행용 역할, SSL 설정 및 배포 환경에 맞는 pooler 연결을 사용한다. prepare:false, 인스턴스별 최대 5개 연결은 현재 코드의 기본값이다. 인스턴스 수 × 풀 크기와 별도 Worker 연결을 DB 한도에 맞춰야 한다.
3. **실행용 DB 역할**: 소유자와 별도 역할을 사용한다. 현재 모든 sliper 테이블은 RLS를 켜고 브라우저 anon/authenticated 접근을 막으며 인가는 Next 서버 서비스에서 수행한다. 따라서 실행용 신뢰 서버 역할에는 sliper의 필요한 테이블 DML·스키마 USAGE·함수 EXECUTE와 RLS 접근을 준비해야 한다. 브라우저 역할에 정책/권한을 열거나 소유자 접속 문자열을 공개하지 않는다. 역할 생성과 권한 검토는 대상 Supabase 관리자가 수행하고 실제 두 회원 권한 분리로 검증한다. 현재 프로젝트에는 운영 역할을 자동 생성하는 명령이 없다.
4. **OAuth**: 카카오·구글 공급자와 정확한 callback 허용 목록을 준비한다. 세션/콜백 코드는 구현되어 있다. 공급자 왕복, 프로필 최초 생성, 로그아웃, 다른 회원의 수정 차단을 실제 신규 계정 2개로 확인한다. [인증 안내](COMMUNITY_FOUNDATION.md)를 참고한다.
5. **미디어 저장소·Worker**: 아래 설정과 private 버킷을 준비하고 위 전체 마이그레이션을 적용한다. Web과 별도 `video:worker`가 같은 DB·원본/결과 저장소를 사용하는지 확인하고 접수→처리→ready→첨부·재생, 중단/재시도/만료·정리를 검증한다. 사진은 브라우저 준비 이후 서버 검증·프로필 교체·공지방 접근도 확인한다.
6. **결제/외부 승인**: 현재 브리지의 주문·서명·회원 공개 ID 연결 계약에 맞게 실제 플랫폼 어댑터를 연결한다. 성공 화면이나 사용자가 입력한 결제 번호만으로 승인하지 않는다. 중복 웹훅, 지연 승인, 정원 초과, 실제 환불 대사를 확인한다. [참가 흐름](PARTICIPATION.md)을 참고한다.
7. **공지방 Redis·푸시/운영**: 서버 전용 REDIS_URL과 필요 시 TLS/인증을 준비하고 실제 구독·다중 Web 인스턴스·장애 후5초 DB fallback을 확인한다. Web Push는 기존 DB 발송 대기열을 사용한다. 안정된 VAPID 키와 실제 연락 URI, PUSH_WORKER_MODE=external을 설정하고 npm run push:worker를 별도 상시 프로세스로 실행한다. HTTPS Android와 홈 화면에 추가한 iPhone에서 직접 수신을 확인한다. DB 백업/복원, 운영 정책·문의 연락처, 장애/대기열 모니터링, 다중 사용자 부하를 검증한다.

## 유료 자료 구매 연동

통합 아카이브의 구매/판매 관리·당시 버전/조건 보존·분쟁·전액 환불 권한 회수는 구현했다. 자동 승인 브리지는 행사 참가 결제와 분리한 `LIBRARY_PAYMENT_PROVIDER`·`LIBRARY_PAYMENT_WEBHOOK_SECRET`를 함께 설정한다. 업체가 실제 거래·회원·총액·전액 환불 완료를 확인한 후 `/api/payments/library-webhook`에 전용 서명 계약으로 전달해야 한다. 설정 형식은 `deploy:check`의 `library-payment` 항목에 표시하며, 실제 업체 연결은 아직 활성화하지 않았다. [자료 결제 계약·중복/역순 알림·이전 구매 호환·검증](TEMPLATE_MARKET.md)을 참고한다.

## 사진·영상 저장소 선택

```dotenv
MEDIA_STORAGE_BACKEND=local
SUPABASE_STORAGE_URL=
SUPABASE_STORAGE_SECRET_KEY=
SUPABASE_STORAGE_BUCKET=
```

기본 local은 .local/uploads(본문 사진), .local/profile-photos(프로필), .local/video-sources(비공개 영상 원본), .local/videos(압축 영상)에 저장한다. Supabase 준비 후 MEDIA_STORAGE_BACKEND=supabase로 바꾼다. URL은 포트·경로·쿼리가 없는 공개 HTTPS 프로젝트 원본, SECRET_KEY는 **서버 전용 sb_secret\_ 키 또는 service_role 키**, BUCKET은 비공개 버킷 이름이다. 인증 클라이언트용 publishable key와 저장소 서버 비밀키는 다르다. 비밀키에는 NEXT_PUBLIC_ 접두사를 사용하지 않는다.

본문 사진은 posts/UUID.webp, 프로필은 profiles/UUID.webp, 비공개 영상 원본은 video-sources/UUID.bin, 결과는 videos/UUID.mp4에 저장한다. private 버킷에는 원본 application/octet-stream·50MiB와 결과 video/mp4·25MiB를 허용하고 [Worker 실행 기준](MEDIA_WORKERS_AND_ROOM_REALTIME.md)을 확인한다. 버킷 전체 제한을25MB로 두면 새 원본 접수가 실패한다. 업로드/다운로드/삭제 전에 실제 버킷이 public=false인지 확인한다. 공개 버킷이면 동작을 거부한다. 브라우저에는 계속 /api/media/ID, /api/profile-photos/ID 또는 /api/videos/ID만 전달하며 공개·서명 URL을 만들지 않는다. 기존 게시글/프로필 인가를 거친 서버가 이미지를 내려준다.

media_assets, profile_photos, video_assets와 영상 작업/결과 원장에 **행별 storage_backend**를 기록한다. 기존 행은 local로 유지하므로 새 업로드를 Supabase로 바꾸어도 기존 파일을 잘못된 저장소에서 읽지 않는다. 업로드 성공 후 DB 저장에 실패하면 새 객체만 정리하고, 기존 프로필 사진은 DB 교체 성공 후 이전 저장소에서 삭제한다. 탈퇴에서도 이전 저장소 정보를 전달한다. 미첨부 사진/ready 영상에는 30일 보관 정책과 PostgreSQL 정리 원장을 구현했다. `npm run media:cleanup`은 미리보기이며 `-- --apply`를 붙여야 실제 정리를 실행한다. 첨부된 파일·행사 기록 출처·프로필은 제외하며 자동 스케줄은 아직 없다. [F2 보관·정리 기준](COMMUNITY_APPEALS_RETENTION_AND_RESTORE.md)을 참고한다. 새 영상 Worker는 원본 만료·최종 상태 원본·시도별 미공개 결과를 원장에 따라 정리하고 삭제 실패를 재시도한다.

설정 변경은 과거 파일을 자동 복사하지 않는다. 업로드 파일은 빌드 추적에서 제외하며 .env·.local·Git·캐시도 서버 배포 산출물에 포함시키지 않는다. 운영 키는 배포 환경변수에서 제공한다. 새 배포 호스트에서 기존 local 이미지를 제공하려면 원래 .local 파일과 지속 디스크가 필요하다. 전체 오브젝트 이전·기존 행의 경로 변경과 원격 백업 복원은 별도 운영 작업이다. 로컬 암호화 백업과 원본을 덮어쓰지 않는 분리 복원은 F2에서 실제 검증했으며 Supabase 객체/운영 DB의 복구 성공을 뜻하지 않는다. 본문 저장소 식별자는 DB 트리거로 임의 변경을 막는다. 반쪽 이전으로 파일이 사라지지 않게 원본을 유지하고 검증 후 전환한다.

## 영상 Worker와 Redis 운영

```powershell
npm run db:migrate
npm run video:worker
# 정리와 한 영상만 처리하고 종료
npm run video:drain
# Docker 엔진이 있는 로컬 환경에서 Redis 준비
npm run redis:local:start
```

Worker는 운영 DB 연결·미디어 비밀키와 Web이 사용하는 원본/결과 저장소에 접근해야 한다. local을 쓰는 다중 프로세스/컨테이너는 같은 지속 디스크를 공유한다. `Dockerfile.video-worker`는 Node22/bookworm-slim에서 npm ci로 해당 플랫폼 FFmpeg/FFprobe와 tsx를 설치하고 비루트 node 사용자로 별도 Worker를 실행한다. 운영 Worker는 같은 Supabase 비공개 버킷에 연결한다. `compose.yaml`은 로컬 Redis 서비스만 제공한다. 컨테이너 실행과 재시작·임대 복구·출력 정리는 배포 환경에서 검증해야 한다. Web은 변환 CPU를 사용하지 않지만50MiB 원본 업로드를 받고 비공개 저장소에 기록하므로 프록시/서버리스 본문·접수 시간 제한을 맞춘다.

공지방 Redis는 서버 전용 `REDIS_URL`을 사용한다. 로컬 compose 주소는 `redis://127.0.0.1:6380`이며 호스트 loopback에만 포트를 연다. 방 UUID만 Pub/Sub 힌트로 전달하며 내용·회원·권한·알림 원본은 PostgreSQL에 둔다. 구독 정상30초/끊김5초 DB 재확인을 유지하므로 Redis 장애가 공지 저장을 롤백하지 않는다. Pub/Sub 유실·재연결·권한 회수와 여러 Web 프로세스 사이 전달을 실제 Redis에서 확인한다. 운영 `push:worker`는 Redis와 별개로 계속 실행한다.

## 로컬 검증과 실제 연결의 경계

- 로컬 PostgreSQL 마이그레이션, 기존 업로드와 본문 편집 HTTP 회귀
- 저장소 모의 테스트: 비공개 버킷, 경로 제한, 중복 덮어쓰기 차단, 저장 실패 롤백, 비밀값 비노출
- 프로필 사진 교체/삭제 서비스 회귀, 과거 local 행의 읽기 유지
- 설정 누락·개발 접근·SSL·공개 비밀키·부분 결제/승인/AdSense 설정을 판별하는 정적 점검
- F2의 30일 미첨부 정리 원장·명시적 실행·암호화 로컬 백업과 분리 DB/미디어의 실제 복원 검증

실제 Supabase Storage, OAuth, 거래·환불·정산, 기기 푸시 수신과 실서비스 부하는 아직 검증하지 않았다. API·Worker와 대기열이 있다고 사용자 폭주 대응이 완료된 것은 아니다. 현재 검색은 PostgreSQL ILIKE/pg_trgm이며 외부 검색 엔진은 사용하지 않는다. Redis는 공지방 SSE 갱신용 힌트에만 사용한다. 사진 준비·영상 Worker·Redis를 도입한 당시 검증에서는 회귀/DB593개·형식·타입·Drizzle·운영 빌드와 실제 FFmpeg/비동기 Worker 영상 HTTP1개가 통과했다. 당시 npm audit는 취약점0개였으며 현재 의존성의 재검사 결과를 뜻하지 않는다. 최신 단계별 검증은 [전체 현황](PROJECT_STATUS_AND_ROADMAP.md)을 기준으로 한다. 로컬 Redis 컨테이너를 실행했고 healthy·PING/PONG 및 실제 Pub/Sub 프로세스 간 통합 검사 1개가 통과했다. 공지 작성 HTTP→DB 커밋→Redis→SSE 갱신과 참가 취소 후 접근 회수도 3초 이내로 확인했다.

공식 자료: [Supabase PostgreSQL 연결](https://supabase.com/docs/guides/database/connecting-to-postgres), [Postgres 역할](https://supabase.com/docs/guides/database/postgres/roles), [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control).

## Supabase 입력 준비와 실제 DB 검사

프로젝트 URL과 키 이름을 `.env.supabase.local`에 준비했다. 빈 비밀값은 사용자가 직접 입력하며 현재 로컬 `.env`는 유지한다. [입력 안내](SUPABASE_CONNECTION_PREPARATION.md)를 따른다. 별도 `npm run deploy:db-check -- --env-file .env.supabase.local --json --strict`는 명시한 DB의 실제 카탈로그·역할·RLS·마이그레이션을 읽기 전용으로 확인한다. 기존 화면/API/`deploy:check`의 configuration-only 의미는 그대로다. [실제 DB 검사의 범위와 한계](PRODUCTION_DATABASE_AUDIT.md)를 확인한다.
