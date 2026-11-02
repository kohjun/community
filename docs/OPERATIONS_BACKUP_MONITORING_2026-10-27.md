# 운영 백업·분리 복원·외부 이메일 감시 — 2026-10-27

이번 작업은 **실제 Supabase DB/Auth 논리 백업과 비공개 파일 암호화 캡처 → 별도 로컬 DB 복원 → 데이터·구조·파일 검증**까지 수행했다. 운영 DB나 Storage를 복원 대상으로 사용하지 않았다. Sliper 서버의 설정·VAPID·인증서 상태도 별도 암호화 파일로 보관했다.

서버에는 경량 상태 감시를 배포했고 정상200·장애503·점검 지연503·복구200을 확인했다. **외부 모니터 등록·이메일 설정 후 실제 장애 경보 메일 도착까지 사용자 확인을 받았다. 감시는200으로 복구했고 정기 점검을 재개했다.**

## 실제 백업과 검증 범위

| 항목 | 결과 |
| --- | --- |
| 원본 | Supabase PostgreSQL17, 운영 private Storage |
| DB 캡처 | auth27 + sliper87 + drizzle1 = 115테이블 |
| 일관성 | 읽기 전용 REPEATABLE READ의 exported snapshot을 pg_dump에도 공유 |
| 파일 | private bucket의5파일, 합계6,765,759바이트 |
| 보관 | SQL 덤프·파일·목록 모두 AES-256-GCM 암호화, 무작위 키를 별도 owner/SYSTEM 전용 경로에 저장 |
| 복원 대상 | 새 로컬 PostgreSQL18 프로세스,127.0.0.1의 새 임시 포트·빈 DB |
| 검증 | 테이블 행 수·내용 다이제스트, RLS·인덱스·제약·NOT NULL 수, 파일 SHA256 일치 |
| 정리 | 임시 DB 정상 종료 후 복원 DB·평문 파일·임시 비밀번호 제거 |
| 실제 원본 변경 | 없음. 알림·영상 전달 워커를 복원 환경에서 시작하지 않음 |
| 서버 설정 |29개의 TAR 항목을 별도 암호화, 복호화·해시·경로 검사 통과 |

DB 덤프에는 Storage 파일 바이트가 들어 있지 않기 때문에 직접 비공개 파일을 캡처한다. 백업 목록도 암호화하며 SQL·개인정보·오브젝트 경로·네이티브 오류 본문을 콘솔에 표시하지 않는다. 현재 앱의 UUID 오브젝트는 덮어쓰기 없이 생성된다. 필요한 로컬 파일 참조나 누락된 물리 파일이 있거나 파일 다운로드가 실패하면 백업 완료로 표시하지 않는다. 관리자가 같은 오브젝트를 별도로 덮어쓰는 운영은 피한다. [Supabase 백업 범위](https://supabase.com/docs/guides/platform/backups).

PostgreSQL18은 NOT NULL을 pg_constraint에도 기록한다. 비교 시 해당 버전 차이를 분리하고 실제 attnotnull 수를 양쪽에서 확인한다. [PostgreSQL18 변경](https://www.postgresql.org/docs/18/release-18.html), [카탈로그](https://www.postgresql.org/docs/18/catalog-pg-constraint.html).

## 보관 위치와 실행 명령

| 경로 | 용도 |
| --- | --- |
| `.local/backup-settings/production.env` | 백업 전용5432 연결·Storage 설정, Git 제외·사용자/SYSTEM 전용 |
| `.local/backups/backup_…/` | 암호화 백업 본체와 비밀값을 담지 않는 암호화 메타데이터 |
| `.local/backup-keys/backup_….key` | 해당 백업의32바이트 복호화 키, 별도 보호 경로 |
| `.local/cloud-capture-latest.json` | 최근 캡처의 개수·용량·ID·검증 전 상태 |
| `.local/cloud-restore-latest.json` | 실제 로컬 논리 복원 검사 결과 |
| `.local/server-recovery-latest.json` | 서버 설정 암호화 백업 결과 |

캡처 결과의 restoreVerified:false는 해당 캡처 시점의 상태다. 같은 ID의 복원 결과를 별도로 확인한다. 잘못된 키·변조·백업 ID 불일치·경로 이탈은 복원을 시작하기 전에 거부한다. 복원 명령은 운영 URL을 입력받지 않으며 도구가 직접 만든 로컬 클러스터만 대상으로 한다. 매 실행마다 임시 경로와 비밀번호를 새로 만든다.

```powershell
# 프로젝트 C:\Sliper에서 실행. 설정값·비밀번호를 명령 인자에 넣지 않는다.
npm run cloud:backup -- --env-file .local/backup-settings/production.env
npm run cloud:restore:drill -- --backup backup_날짜_ID

# 운영 백업 전 준비 상태 확인은 별도이며 캡처 성공을 뜻하지 않는다.
npm run cloud:backup:preflight -- --env-file .local/backup-settings/production.env
```

로컬 검증에는 설치된 C:/Program Files/PostgreSQL/18/bin의 도구를 사용했다. 다른 플랫폼의 도구 경로와 호환성은 별도 확인한다. 네이티브 명령은 비밀번호를 환경으로 전달하며 표준 오류에 들어갈 수 있는 개인정보·SQL 행을 출력하지 않는다. 복원은 단일 트랜잭션으로 실행하고 오류가 있으면 성공으로 표시하지 않는다. [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

서버 설정 백업은 [backup-server-config.ts](../scripts/backup-server-config.ts)를 사용한다. 배포용 SSH 키·고정 호스트키 검증을 유지하며 Sliper에 속한 파일만 읽는다. 기존 사이트의 키·설정·SSH 개인키는 포함하지 않는다. 서버 파일을 읽는 동안 runtime.env/Caddyfile이 바뀌면 완료로 표시하지 않는다. 서버 설정·키는 PC의 평문 파일로 저장하지 않고 메모리에서 암호화한다.

```powershell
node --import tsx scripts/backup-server-config.ts --host PUBLIC_IP --key C:/Users/사용자/.ssh/sliper-deploy/id_ed25519 --known-hosts C:/Sliper/.local/ncloud_known_hosts
```

키를 잃으면 백업을 복호화할 수 없다. **암호화 본체와 키는 별도 안전한 보관처에도 보관해야 한다.** 현재 사본은 운영 서버와 분리된 개발 PC에 있다. 다른 외부 보관처로 업로드하거나 키를 외부 서비스에 전달하지 않았다. 자동 일정·보관 기간·별도 외부 보관처는 아직 설정하지 않았으며 백업을 임의로 삭제하지 않는다.

## 이번 복원으로 검증하지 않은 부분

로컬 논리 복원 성공을 Supabase 전체 재해복구 성공으로 표현하지 않는다.

- 별도의 빈 Supabase 프로젝트로의 복원, 그 환경의 실제 OAuth 로그인·Storage 업로드·Realtime 재연결은 미검증이다.
- Auth/앱/마이그레이션 데이터와 private 파일은 캡처했지만 관리형 서비스 설정·OAuth 제공자 비밀값·Vault 암호화 루트 키·플랫폼 전체를 덤프하지 않는다. 필요 시 공식 프로젝트 이관 절차를 따른다.
- 로컬 검증은 원본의 소유권·GRANT를 덮어쓰지 않고 로그인 불가 역할로 구조를 복원한다. 실제 운영 권한은 별도 프로젝트에서 다시 확인해야 한다.
- 라이브 데이터는 캡처 snapshot 시점 이후에도 변한다. 이 도구는 별도 PITR이나 RPO/RTO 보장 서비스가 아니다.
- 서버 설정은 암호화·복호화·안전한 TAR 경로까지만 검사했으며 다른 서버에 실제로 복구하지 않았다.

## 경량 운영 감시

외부 감시 URL은 현재 Sliper의 **`https://공인IP:13000/ops/health`**다. 인증 없이 GET/HEAD가 가능하며, 응답은 정상 `{"status":"ok"}` 또는 비정상 `{"status":"unavailable"}`만 제공한다. 상세 상태·PID·경로·회원·키는 외부 응답에 포함하지 않는다. POST는405, Cache-Control은no-store다.

```text
외부 감시 서비스 → Sliper HTTPS /ops/health → loopback13002의 경량 상태 서버
                                            ↑ 상태 사본(120초 지나면503)
                         30초 systemd timer → root 전용 상태 점검
```

| 감지 항목 | 기준 |
| --- | --- |
| 웹·TLS·알림·영상 서비스 | active/running 및 MainPID 존재 |
| 알림 워커 진행 | 같은 서비스 PID가 기록한 성공 주기가180초 이내 |
| 영상 워커 진행 | 같은 서비스 PID가 기록한 성공 주기가900초 이내 |
| 웹 응답 | 내부 /api/health가200·status=ok |
| 인증서 | 만료까지48시간 이상 |
| 디스크 | 가용2GiB 이상 |
| 메모리 | MemAvailable256MiB 이상 |
| 감시 자체 | 상태 사본이120초보다 오래됐거나 읽기 실패하면503 |

주기 점검은 새 DB 질의를 하지 않는다. DB 작업 성공을 기록한 기존 워커 진행 파일과 서비스 상태를 재사용한다. 실제 감지 시간에는 워커의 유효기간·30초 점검 주기·외부 서비스 주기와 장애 확정 대기시간이 더해진다. 작업 정체도 프로세스 생존과 구분한다. 자동 재시작은 기존 Sliper 서비스 정책을 따르며 감시 도구는 임의로 서비스를 중지하거나 재시작하지 않는다.

- `sliper-monitor-probe.service`: root, 읽기 목적 CAP_DAC_READ_SEARCH만 보유. 앱 환경파일을 읽지 않는다.
- `sliper-monitor.timer`:30초마다 위 점검을 실행한다.
- `sliper-monitor.service`: 별도 비로그인 계정,127.0.0.1:13002만 수신. root 소유 상태 사본을 읽기만 한다.
- `/opt/sliper/ops/sliper-monitor.py`: Python 표준 라이브러리만 사용한다. 새 DB·Redis·대시보드 서버 의존성을 추가하지 않는다.
- `/var/lib/sliper-monitor/status.json`: root:sliper-monitor0640. 상세 상태는 로컬 운영자용이다.

공개 Next 서버가 죽어도 Caddy는 감시 주소로503을 전달한다. TLS나 인스턴스가 완전히 멈추면 외부 감시가 접속 실패를 감지한다. 앱의 일반 /api/health와 운영 감시 /ops/health는 목적이 다르다. 호스트 안의 timer만으로는 호스트 전체 장애 시 이메일을 보낼 수 없다.

## 이메일 연결 — 등록·실제 경보 수신 확인 완료

사용자가 BetterStack 모니터 등록과 이메일 설정 완료를 확인했다. Sliper 감시 주소는 외부 GET/HEAD200으로 재확인했고 원본 서비스·감시 timer도 정상이다. BetterStack 계정에 도구 연결이 없어 등록과 실제 메일 도착은 사용자 보고를 근거로 한다. 감시503·앱200·최종 복구200·정기 점검 재개는 도구로 직접 검증했다.

외부 감시는 BetterStack의 HTTP status 모니터 설정으로 안내했다. 확인 당시 개인 프로젝트 무료 항목에10개 모니터·이메일 알림이 명시돼 있다. 계정 생성·로그인·수신 이메일 인증은 사용자가 완료하고 요금제 선택 화면의 조건을 확인한다. 유료 계정·결제·외부 모니터를 대신 생성하지 않았다. [공식 가격 안내](https://betterstack.com/pricing), [설정 안내](https://betterstack.com/docs/uptime/monitoring-start/).

1. 이메일을 받을 계정으로 BetterStack에 로그인한다.
2. Monitors → Create monitor에서 실제 Sliper의 `/ops/health` 전체 HTTPS 주소를 넣는다.
3. 정상 응답은200, 인증서 검증은유지, 알림은Email로 설정한다.
4. 모니터가Up인지 확인하고 설정의 테스트 알림과 실제 이메일 도착을 확인한다.
5. 별도 SSL 만료 알림을 사용하면 짧은 IP 인증서에 맞춰1일 전으로 설정한다. 서버 감시는48시간 여유도 확인한다. 일반적인30일 만료 알림을 적용하면 이 IP 인증서는 계속 경보가 될 수 있다.

사용자가 본인만 수신한다고 확인하고 실제 경보 테스트를 승인했다. 약167초간 감시 주소를503으로 둔 상태에서 장애 이메일 도착을 확인받았고 즉시 복구했다. 이메일 비밀번호·SMTP 비밀번호·API 토큰을 채팅에 보낼 필요가 없다. 로컬 점검 로그에는 메일 주소나 회원 데이터를 넣지 않는다. 서비스 중단을 만들지 않고 감시 사본에만 실패/지연을 넣어503·복구200을 검증했다.

## 운영 명령과 다음 순서

```sh
systemctl is-active sliper-web sliper-tls sliper-notifications sliper-video sliper-monitor sliper-monitor.timer
systemctl start sliper-monitor-probe.service
journalctl -u sliper-monitor-probe -n 20 --no-pager
curl --fail https://PUBLIC_IP:13000/ops/health
```

감시 source·unit은 [native 템플릿](../deploy/native/)에 보관한다. 변경은 Linux 구문·systemd 단위·Caddy 검증을 거친다. 기존 사이트의 Nginx 파일·프로세스는 유지했다. 웹 소스를 변경하지 않아 현재 Next 릴리스는 유지했다.

남은 순서는 정기 백업·보관처·키의 별도 보관 설정 → 새 Supabase 프로젝트의 관리형 서비스 복원 → iPhone/실제 댓글·공지 알림 → 제한된 부하·베타 운영 검증이다. 계정·새 유료 프로젝트·외부 보관처 없이 완료했다고 표시하지 않는다.


## 최종 검사 결과

- `npm run check`: 비밀값·포맷·전체 타입·테스트1,093개·마이그레이션 원장 검사 통과.
- Python 감시 단위 테스트5개 통과.
- 실제 암호화 캡처와 로컬 분리 복원, 서버 설정 암호화/복호화 검증 통과.
- 운영 서버에서 검토 소스/배포 파일 SHA256 일치, 앱/워커/TLS/감시 active·예상 밖 재시작0.
- 기존 사이트 설정 파일 해시와 프로세스 유지, HTTP200.
- 외부 감시 주소 GET/HEAD200·POST405·no-store, 합성 실패/점검 지연503·복구200.
- Range206·SSE·본문 크기 제한413·로그 제거 회귀 검사 통과.

검증 요약은 Git 제외 `.local/operations-verification-summary.json`이며 캡처·복원·서버 설정의 최근 ID/결과도 같은 폴더의 별도 요약에 보관한다. 실제 휴대폰 푸시 수신 확인은 앞선 배포 기록을 유지했다. 초기 감시 배포에서는 이메일을 발생시키지 않았다. 이후 수신자 본인 확인·테스트 승인 후 감시503으로 BetterStack 경보를 발생시켜 실수신을 확인했다. 새 유료 자원은 만들지 않았다.


## 실제 이메일 경보 드릴 결과와 재사용

[sliper-monitor-email-drill.sh](../deploy/native/sliper-monitor-email-drill.sh)를 서버의 root 전용 `/opt/sliper/ops/`에 준비하고 Bash 구문을 검증했다. `--start`는 실제 BetterStack 경보를 발생시킬 수 있어 수신 범위와 실행 여부를 먼저 확인한다. 기본 에스컬레이션 설정은 다른 운영자까지 알릴 수 있다. 실제 이메일 도착과 등록 완료를 구분한다. [BetterStack 알림·에스컬레이션](https://betterstack.com/docs/uptime/monitoring-start/).

- `--start`: 자동 복구 timer를 먼저 등록한 뒤 감시 점검만 잠시 멈추고 감시 응답을503으로 만든다. 웹·TLS·알림·영상 서비스는 중단하지 않는다.
- 최대8분 후 자동 복구하며 `--recover`로 즉시 복구할 수 있다. 실제 점검을 다시 실행하므로 실제 장애가 있으면200을 억지로 반환하지 않는다.
- 경보 메일은 외부 모니터의 점검 주기와 장애 확정·에스컬레이션 설정에 따라 전달된다. 단일 상태 변경이 즉시 이메일을 보장하지 않는다.
- 드릴은 감시 가용성 이력에 테스트 장애를 남길 수 있다. 실제 서비스 중단과 구분해 기록한다.

이후 사용자의 본인 수신 확인과 실행 승인을 받아 테스트를 진행했고, 경보 메일 도착을 확인한 즉시 조기 복구했다. 향후 반복 테스트도 수신 범위를 확인하고 실제 경보임을 공유한 뒤 실행한다.


모니터 등록 후 감시 주소GET/HEAD200과 원본 서비스 정상, 검토 코드와 배포 파일 일치를 다시 확인했다. 경보를 만들지 않는3초 복구 timer 사전 검사에서 복구 명령 Result=success·ExecMainStatus=0 및 감시200을 확인했다. 이 사전 검사 이후 실제503 경보 드릴과 이메일 도착 확인·복구를 완료했다.


후속 이메일 드릴: 사용자가 수신자가 본인뿐임을 확인하고 실제 테스트를 승인했다. 자동 복구 timer를 먼저 기동한 뒤 감시만503으로 전환했다. 외부 /ops/health503과 앱 /api/health·로그인·번개 페이지200을 확인했다. 드릴은 최대8분이며 실제 메일 도착 확인 시 즉시 복구한다. 테스트 종료 후 실제 경보 수신과 최종 복구를 구분해 아래 결과로 기록했다.


### 실제 이메일 경보 드릴 최종 결과

- 사용자가 이메일 수신 대상이 본인뿐임을 확인하고 테스트 실행을 승인했다.
- 자동 복구 timer를 먼저 등록한 뒤 감시 응답만503으로 전환했다. 외부 감시503·웹 생존/로그인/번개200을 직접 확인했다.
- 사용자가 BetterStack 장애 경보 메일 도착을 확인했고, 즉시 감시 점검과30초 timer를 재개했다. 테스트 구간은 약167초다.
- 외부 감시GET/HEAD200·POST405 및 no-store, 전체 Sliper 서비스 active와 기존 사이트200을 재확인했다. 자동 복구 timer는 조기 복구 후 중지했다.
- 실제 웹·TLS·알림·영상 서비스를 중지하지 않았다. 실제 커뮤니티 데이터·회원 세션을 변경하지 않았다.
- 복구 안내 메일 도착은 별도로 확인하지 않았다. BetterStack 화면의 복구 반영 시간은 설정된 점검/복구 주기를 따른다.

Git 제외 `.local/mail-drill-result.json`과 `.local/ncloud-mail-drill-recover.log`에 수신 확인 근거와 기술 검증을 구분해 보관한다. 계정 이메일 주소·메일 본문·인증 정보는 수집하지 않았다.

복구 이후 자동 점검 주기의 상태 사본 갱신과 최신 healthy:true, 감시/앱200도 추가 확인했다.
