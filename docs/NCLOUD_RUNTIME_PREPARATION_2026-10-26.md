# Ncloud 실행 구성 준비 — 2026-10-26

> **배포 대상 갱신:** 사용자가 기존 다른 사이트를 운영하던 Ncloud 인스턴스의 재사용을 선택했다. 새 서버 생성 전에 [기존 인스턴스 공존 배포](NCLOUD_EXISTING_INSTANCE.md)부터 확인한다. 아직 SSH 접속·원격 포트 개방·기존 프록시 변경을 수행하지 않았다. 아래 초기 서버 미준비 기록은 이 선택 이전의 검증 상황이다.

사용자가 서버·도메인이 아직 없음을 확인했다. 이번 단계는 로컬 Linux 컨테이너와 배포 설정 검증이다. Ncloud 자원·도메인 구매, 공개 서버 배포, 실제 휴대폰 푸시나 원격 복원을 실행한 결과가 아니다.

## 준비한 구성

```text
HTTPS :443 → Caddy → web:3000 (Next.js standalone)
                     ├─ Supabase Auth / PostgreSQL / private Storage / Realtime
                     ├─ notifications: 알림함·푸시·자리 안내·파일 삭제 재시도
                     └─ video: 동시 1개 영상 압축
```

| 파일 | 역할 |
| --- | --- |
| compose.production.yaml | 웹·알림·영상, 이미지 버전 태그, 자원 상한과 로그 회전 |
| compose.https.yaml / deploy/Caddyfile | 도메인 HTTPS·인증서 자동 갱신·프록시. DNS 설정 후에만 실행 |
| Dockerfile.web | Node 24, 빌드 후 standalone만 실행, 비루트 사용자 |
| Dockerfile.notification-worker / Dockerfile.video-worker | Node 24의 별도 워커와 진행 상태 점검 |
| production.env.example | 웹/워커 운영 설정의 빈 값. 실제 .env.production은 Git/Docker에서 제외 |
| backup.production.env.example | 백업 전용 별도 설정. 웹·워커에 전달하지 않음 |

Linux 이미지 기준을 Node 24로 맞췄다. 잠금된 QR 의존성에 Node 24 이상 요구가 있어 기존 Node 22 이미지의 경고를 제거한다. 원본 코드의 엔진 하한을 Linux 검증 결과와 혼동하지 말고 운영에서는 검증한 Dockerfiles를 사용한다.

프록시의 본문 상한은 64MB이며 앱의 경로별 제한을 유지한다. SSE와 영상 Range를 버퍼링 없이 전달한다. 요청 헤더·OAuth 코드가 들어가는 URI는 프록시 오류 로그에서 제거하고 접근 로그는 기본 비활성화한다. 앱 컨테이너 로그는 각각 10MB × 3개로 회전한다.

## 상태 점검과 종료

- GET /api/health, HEAD /api/health: DB/Auth에 연결하지 않는 웹 생존 점검. no-store이며 회원·환경·버전 정보를 반환하지 않는다. DB·로그인·전체 서비스의 준비 완료를 의미하지 않는다.
- 워커는 /tmp의 작은 상태 파일에 PID·시작 시각·성공 시각만 남긴다. 별도의 타이머가 건강한 상태를 만들어내지 않으며 성공한 작업 단계가 상태를 갱신한다.
- 알림 워커는 알림함/푸시/정리 단계 사이에도 진행을 기록한다. 종료 요청을 받으면 현재 단계 뒤 다음 단계로 들어가지 않는다. 알림 180초, 영상 900초 동안 진행이 없거나 PID가 종료되면 건강하지 않은 상태다.
- 종료 유예는 알림 180초·영상 300초다. 유예를 넘어 강제 종료되면 영속 임대로 작업을 복구한다. 외부 푸시 제공자 수락과 DB 확인 사이의 장애에서는 중복 알림 가능성을 완전히 배제하지 않는다.
- Docker healthcheck는 상태를 표시한다. unless-stopped는 프로세스 종료 시 재시작 정책이며 unhealthy 표시만으로 자동 재시작하지 않는다. 실제 경보 전달과 운영자의 대응 채널은 서버 준비 후 연결한다.

```sh
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml exec -T notifications node --import tsx scripts/worker-health.ts notification
docker compose --env-file .env.production -f compose.production.yaml exec -T video node --import tsx scripts/worker-health.ts video
```

작업이 하나 실패했다고 워커 전체가 멈춘 것과 같지는 않다. /admin/health의 알림·영상·파일 정리 대기/실패/오래된 임대도 함께 확인한다. 상태 파일에 회원·본문·객체 주소를 넣지 않는다.

## 서버가 준비되면 실행할 순서

1. [Ncloud 생성 가이드](NCLOUD_DEPLOYMENT.md)의 OS·사양·접속 설정을 확인하고 서버를 생성한다. 검토 기준은 Ubuntu 24.04 LTS x86_64·RAM 8GB이며 실제 월 견적을 확인한다. SSH는 운영자 IP만, 웹은 80/443만 허용한다. 3000은 외부에 열지 않는다.
2. 소스와 잠금 파일만 전송한다. .env·.local·개인키를 소스 압축본이나 Git에 넣지 않는다. 서버에 Docker/Compose를 설치한다.
3. 보호된 .env.production을 새로 만들고 기존 Supabase 제한 실행 역할·서버용 Storage 키와 공개 키를 채운다. 마이그레이션/백업 관리자 자격은 넣지 않는다. VISITOR_HASH_SECRET과 VAPID 기존 값을 재사용하고 임의로 키를 교체하지 않는다. 새 VAPID는 정식 연락 URI가 정해진 뒤 발급한다.
4. SLIPER_RELEASE를 고정하고 아래 기본 구성의 문법 검사·빌드·기동을 수행한다. 이 검사는 DNS·DB 연결·로그인 성공을 보장하지 않는다.

```sh
# 새 파일일 때만 복사하고 운영값을 입력한다. 이미 채운 파일을 덮어쓰지 않는다.
cp -n production.env.example .env.production
chmod 600 .env.production

docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --pull never
curl --fail http://127.0.0.1:3000/api/health
```

5. 도메인을 구매하고 DNS A 레코드를 서버 IP로 연결한다. 실제 소유한 hostname을 SLIPER_DOMAIN에, 인증서 연락 이메일을 ACME_EMAIL에 넣는다. APP_ORIGIN은 같은 도메인의 https 주소로 설정한다. DNS·80/443 도달 확인 후에만 HTTPS 구성을 실행한다.

```sh
docker pull caddy:2.11.7-alpine
docker compose --env-file .env.production -f compose.production.yaml -f compose.https.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml -f compose.https.yaml up -d --no-build --pull never
curl --fail https://YOUR_OWNED_DOMAIN/api/health
```

프록시 이미지 caddy:2.11.7-alpine은 기동 전에 명시적으로 pull한다. 위 --pull never는 검증하지 않은 새 앱 이미지를 자동으로 가져오지 않게 한다. 앱 3개는 같은 SLIPER_RELEASE로 빌드한다. Caddy 인증서 볼륨은 재배포 때 유지하며 down -v로 지우지 않는다.

6. Supabase Site URL/Redirect URLs, 지도 허용 도메인과 카카오·Google의 필요한 웹 원본을 갱신한다. Supabase 공급자 자체의 콜백은 기존 프로젝트 주소를 유지한다. 로컬 PC의 APP_ORIGIN을 미구매 도메인으로 바꿀 필요는 없다.
7. 아래 실제 기기·회원 흐름을 검증한 뒤 제한 공개한다. 광고·실제 결제는 승인/공급자 확인 전 비활성화한다.

## 배포 버전과 되돌리기

SLIPER_RELEASE는 소스 버전별로 다르게 지정하고 이전 3개 앱 이미지와 배포 소스 버전을 보관한다. 문제 시 같은 운영 환경값으로 이전 이미지 태그를 선택한다.

```sh
# 보관된 이전 태그가 실제로 있는지 확인한 뒤 실행한다.
SLIPER_RELEASE=PREVIOUS_TAG docker compose --env-file .env.production -f compose.production.yaml -f compose.https.yaml up -d --no-build --pull never web notifications video
```

이 명령은 앱 컨테이너의 되돌리기다. DB를 과거로 복원하지 않으며, 새 마이그레이션과 이전 앱의 호환성을 먼저 확인한다. 단일 서버이므로 교체 시 짧은 중단과 SSE 재연결이 생길 수 있다.

## 백업 사전 점검과 실제 복원의 구분

기존 backup:local / backup:verify는 격리 로컬 DB·파일용이다. Supabase 복원 성공으로 표시하지 않는다. 새 명령은 원격 DB의 읽기 전용 REPEATABLE READ 메타데이터 조회와 비공개 버킷·도구·복원 대상 검사를 수행한다.

```sh
# 앱 설정으로 현재 소스의 읽기 전용 준비 상태만 확인
npm run cloud:backup:preflight

# 백업용 설정은 독립 파일로 읽으며 기존 .env와 합치지 않음
npm run cloud:backup:preflight -- --env-file .env.backup
```

.env.backup의 BACKUP_DATABASE_URL은 소스의 direct/session(5432) 백업 전용 연결이다. 별도 새 프로젝트의 BACKUP_RESTORE_PROJECT_URL과 BACKUP_RESTORE_DATABASE_URL을 준비한다. 같은 프로젝트 또는 기존 Sliper 테이블/Auth 사용자가 있는 대상을 거부한다. Auth 사용자 수가 RLS로 가려지면 빈 대상으로 잘못 판정하지 않고 점검을 중단한다. 읽기 전용 트랜잭션의 row_security=off는 권한을 우회하지 않고 누락 가능성에 오류를 발생시킨다. [PostgreSQL RLS 백업 주의점](https://www.postgresql.org/docs/17/ddl-rowsecurity.html). 관리자 백업 키를 웹/워커 환경에 넣어 검사 경고를 지우지 않는다.

Supabase DB 백업에는 Storage 객체 바이트가 포함되지 않는다. 실제 복구 검증에는 DB/Auth와 Storage의 암호화 캡처, 일관된 점검 시점, 서버 밖 사본, 별도 대상의 복원, 파일 해시·권한과 업무 흐름 재검증이 필요하다. 새 도구는 덤프·복원·파일 다운로드·권한 변경·알림 워커 실행을 하지 않는다. [Supabase 백업 안내](https://supabase.com/docs/guides/platform/backups), [백업·복원 절차](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## 실제 기기 검증표

| 구분 | 확인할 동작 |
| --- | --- |
| 회원 2명 | 각각 로그인·기본정보·로그아웃·원래 화면 복귀 |
| 주최자/참가자 | 무료 번개 신청→승인→공지방, 타인 수정/메시지 발송 거부 |
| 이미지/영상 | 브라우저 압축·업로드·영상 워커·부분 재생, 차단/비회원의 비공개 접근 거부 |
| Android | HTTPS Chrome·홈 화면 추가·알림 허용/거부·공지/댓글 수신·알림 클릭 복귀 |
| iPhone | Safari 안내→홈 화면 추가→웹앱 실행→알림 허용·거부 복구·수신·복귀 |
| 행사 이후 | QR 확인·종료·회고·제작진 수락·기록/포트폴리오 연결 |
| 장애/부하 | 워커 재시작·임대 복구·작업 중복, 동시 신청·공지·영상 시 자원과 지연 |

## 이번 검증 결과

| 검사 | 결과 |
| --- | --- |
| Linux 이미지 | Node 24 웹·알림·영상 빌드 성공. 실제 배포 시 공개 Supabase 식별자를 전달해 다시 빌드 |
| 운영 웹 추적 | 117개, 비밀파일 제거 필요 0·워커 의존성 0·오류 0 |
| 컨테이너 integration | 3/3. network none, UID1000. 웹 생존 점검, 상태 CLI 전환, 실제 합성 영상 압축 |
| 웹 배포 파일 | 2,739개, 비밀파일·워커 바이너리·외부 링크 0 |
| 실제 프록시 integration | 1/1. 2바이트 Range206·SSE 선전달·과대 본문413·전달 헤더 위조 차단·민감 로그 제거 |
| 새 진행 상태/웹 생존 검사 | 4/4. 성공 전/만료/종료/잘못된 파일은 건강하지 않은 상태 |
| 실제 알림 워커 | 소유한 기존 로컬 프로세스를 교체했고 정상 진행 상태와 오류 로그 없음 확인 |
| Supabase 백업 사전 점검 | PASS4 / WARN3 / FAIL0. PostgreSQL17·87테이블·74마이그레이션·준비된 객체5개/예상6,765,759바이트·로컬참조0 |
| 기본 전체 검사 | 비밀값·서식·타입·기본 테스트 1,067/1,067·마이그레이션 검사 통과. 후속 RLS 보완은 집중 7/7·타입 검사 통과 |

전체 검사 이후 마지막 RLS 경계 보완으로 백업 집중 검사는 6개에서 7개가 됐다. 집중 7개 중 6개는 앞선 기본 전체 검사와 중복되며, 기본 전체 검사를 모두 다시 실행한 것으로 계산하지 않는다.

백업 점검은 객체 바이트를 다운로드하거나 검증하지 않았다. 로컬 PostgreSQL18 도구와 비공개 버킷만 확인했으며 실제 백업 생성과 원격 복원은 미수행이다. 실제 배포에 사용할 공개 식별자를 생략한 Linux 웹 이미지는 격리 검사용이며 배포용 이미지와 구분한다.

Docker 통합 검사는 다음과 같이 명시적으로 실행하며 기본 npm run check에는 포함하지 않는다.

```sh
# 지정한 태그로 로컬 이미지를 먼저 빌드해야 한다.
SLIPER_TEST_RELEASE=YOUR_TEST_TAG node --import tsx --test tests/container-runtime.integration.ts
node --import tsx --test tests/container-proxy.integration.ts
```

로그는 Git 제외 .local/deployment-*-build.log, deployment-runtime-smoke.log, deployment-proxy-smoke.log, deployment-full-check.log와 cloud-backup-preflight-runtime.json에 보관했다. 테스트 컨테이너/네트워크는 소유 표시를 확인해 정리했고 검증한 로컬 이미지만 남겼다.

Ncloud 서버와 실제 도메인, 별도 복원 프로젝트가 준비되면 위 실행 순서부터 이어간다. 준비 전에는 이 결과를 공개 운영 인증으로 해석하지 않는다.
