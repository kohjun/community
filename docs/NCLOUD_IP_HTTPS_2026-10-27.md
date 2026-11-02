# Ncloud 별도 포트 HTTPS·로그인·푸시 연결 — 2026-10-27

> 후속 운영 검증: DB115테이블·private5파일의 암호화 캡처와 새 로컬 DB 복원, 서버 설정/키의 암호화 보관, 경량 감시200/503/복구를 검증했다. 외부 이메일 도착·정기 백업·새 Supabase 관리형 복구는 남아 있다. [최신 운영 결과](OPERATIONS_BACKUP_MONITORING_2026-10-27.md). 아래 HTTPS 단계별 수치는 당시 기록이다.

Sliper의 공개 TCP13000을 신뢰할 수 있는 HTTPS로 전환했다. 기존 HTTP 링크는 경로·검색 조건을 보존한 HTTPS308로 이동한다. 인증서 예외 허용이나 보안 쿠키 완화는 사용하지 않았다. Google·Kakao 실제 계정 로그인 성공은 사용자 확인을 받았다. Android Chrome 실기기의 테스트 푸시 도착도 사용자 확인을 받았다. iPhone 실기기 수신은 아직 별도 확인이 필요하다.

## 실제 연결 구조

```text
외부 HTTPS :13000 → sliper-tls(Caddy) → 127.0.0.1:13001 → sliper-web(Next)
외부 HTTP  :13000 → 같은 주소의 HTTPS로308
외부 HTTP  :80 / IP Host의 ACME 경로만 → 127.0.0.1:13080 → 인증서 자동 갱신
기존 사이트 :80/:443 → 기존 Nginx 설정 → 기존 Node/PM2 :3000
알림·영상 → 기존 Sliper 전용 systemd 워커 → Supabase
```

Sliper는 기존 사이트의 도메인을 공유하지 않는다. Nginx에는 IP Host의 인증서 확인 경로를 처리하는 별도 파일 하나만 추가하고 구문 확인 후 graceful reload했다. 기존 사이트 설정 파일의 SHA256·Node 프로세스가 유지됐고 기존 두 HTTPS 호스트는 모두200, HTTP는301을 반환했다. 기존 인증서·PM2·전역 Node20·방화벽 규칙을 변경하지 않았다.

## 인증서와 실행 권한

- 공식 SHA256을 확인한 Caddy2.11.7 Linux x64 바이너리를 별도 런타임 경로에 설치했다.
- Let’s Encrypt `shortlived` 프로필로 공인 IP 인증서를 발급했다. 인증서 SAN에 실제 IP가 있으며 외부 Node·Chrome, 서버 curl의 일반 신뢰 검증을 통과했다.
- 이번 인증서 만료는 **2026-11-03 11:02:41 한국 시간**이다. 약160시간 인증서라 Caddy 자동 갱신이 필수다. 자동 관리가 실행 중이며 다음 실제 갱신 성공은 아직 관찰하지 않았다.
- TLS는 별도 비로그인 `sliper-tls` 계정으로 실행한다. 인증서·ACME 개인키는 해당 계정의0700 상태 폴더에만 있고 앱 계정과 분리했다.
- TLS 프로세스는 Supabase 비밀값이 있는 `/etc/sliper/runtime.env`를 읽지 않는다. 애플리케이션은 기존 root:sliper0640 환경파일을 사용한다.
- Sliper 웹은 외부에 직접 노출하지 않고127.0.0.1:13001에서 실행한다. 공개 포트는 계속13000 하나다. 검증용13080도 loopback으로만 열려 있다.
- TCP만 사용하도록 HTTP/3을 광고하지 않는다. 32KB 헤더·64MB 본문 상한, 헤더/본문 수신 시간 제한을 적용했다. SSE와 Range 응답은 버퍼링하지 않으며 오류 로그의 URI·요청 헤더는 제거한다.

IP 인증서는 공개80 HTTP-01 검증이 필요하다. **추가한 인증서 경로와80번 접근을 없애면 자동 갱신이 실패할 수 있다.** 기존443 포트나 기존 인증서 갱신 작업은 사용하지 않는다. [Let’s Encrypt IP 인증서](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability), [HTTP-01 검증](https://letsencrypt.org/docs/challenge-types/), [Caddy 인증서 설정](https://caddyserver.com/docs/caddyfile/directives/tls).

## 서버 경로와 템플릿

| 경로 | 역할 |
| --- | --- |
| `/opt/sliper/runtime/caddy/caddy` | 검증한 Caddy2.11.7 |
| `/etc/sliper-tls/Caddyfile` | Sliper 전용 TLS/프록시 설정 |
| `/etc/sliper-tls/runtime.env` | 공개 IP·포트·내부 포트 설정만 보관 |
| `/var/lib/sliper-tls/certificates` | 인증서·ACME 상태,0700 |
| `/etc/nginx/sites-enabled/zz-sliper-ip-acme` | 기존 기본 사이트 다음에 읽는 IP 전용 검증 경로 |
| `/etc/systemd/system/sliper-web.service.d/https-backend.conf` | 웹 loopback13001 설정 |
| `sliper-tls.service` | 전용 TLS 서비스, 부팅 자동 시작 |

원본 템플릿은 [Caddyfile.ip-https](../deploy/native/Caddyfile.ip-https), [TLS 서비스](../deploy/native/sliper-tls.service), [웹 drop-in](../deploy/native/sliper-web-https.conf), [인증서 검증 경로](../deploy/native/sliper-ip-acme.nginx.conf)다. 새 서버에서는 IP와 경로를 검토해 설정하고 같은 포트가 비어 있는지 확인한다. 기존 서비스를 덮어쓰는 일괄 설치 스크립트로 사용하지 않는다.

## Supabase URL 설정 — 저장·복귀 경로 확인 완료

사용자가 Site URL과 Redirect URL 저장 완료를 확인했다. 이후 Google·Kakao 각각 Supabase 인증 시작→의도적인 인증 취소→복귀를 검사했고, 두 경로 모두 새 HTTPS `/auth/callback?returnTo=/mypage`로 돌아왔다. 이 검사는 실제 회원 인증 전에 취소하며 계정 비밀번호·세션을 사용하지 않는다. 이후 사용자가 새 HTTPS 사이트에서 Google·Kakao 실제 계정 로그인 성공을 모두 확인했다. 이 성공 확인의 근거는 사용자 보고이며 서버가 계정 비밀번호나 세션을 수집한 것은 아니다.

실행 서버의 `APP_ORIGIN`은 새 HTTPS 주소로 바꿨다. Google·Kakao 로그인 시작 요청은 올바른 Supabase authorize 주소로303 응답하고 PKCE 쿠키는 Secure를 사용한다. `/api/auth/session`은 `available:true`, `mode:supabase`를 반환한다. 이는 **로그인 시작 준비** 검사이며 실제 계정 인증 완료 검사는 아니다.

[Supabase Authentication → URL Configuration](https://supabase.com/dashboard/project/rujzymheazodvyprytgu/auth/url-configuration)에서:

1. **Site URL**을 실제 Sliper의 `https://공인IP:13000`으로 저장한다.
2. 기존 Redirect URLs를 보존하고 `https://공인IP:13000/auth/callback`을 추가한다.
3. 필요하면 쿼리 전용 패턴 `https://공인IP:13000/auth/callback\?returnTo=**`도 추가한다. 도메인 전체에 대한 `/**`는 필요하지 않다.
4. 로컬 테스트를 유지한다면 localhost/127.0.0.1 콜백 허용 항목도 보존한다. 이전 Site URL만으로 허용되던 로컬 복귀 주소는 별도 Redirect URLs 등록이 필요할 수 있다.
5. 새 HTTPS 로그인 페이지에서 Google·Kakao 각각 로그인 → 프로필 → 로그아웃 → 재로그인한다.

공개 IP는 Redirect URLs에만 추가하면 거부될 수 있어 **Site URL 변경이 필수**다. 같은 원본의 콜백 쿼리는 Site URL 확인으로 허용된다. Google·Kakao 개발자 설정의 **Supabase `/auth/v1/callback` 주소는 바꾸지 않는다.** [Supabase 리디렉션 문서](https://supabase.com/docs/guides/auth/redirect-urls), [현재 Auth 검증 소스](https://github.com/supabase/auth/blob/master/internal/utilities/request.go).

대시보드 설정은 사용자가 완료했다. 현재 연결에는 Management API 관리 토큰이 없어 설정을 대신 변경하거나 전체 Auth 설정을 읽지 않았다. DB 비밀번호나 Storage 비밀키로 관리 API에 접근하지 않는다. 필요할 때 사용할 [설정 도구](../scripts/supabase-auth-origin.ts)는 기본 조회만 하고 `--apply`에서 URL 설정 두 필드만 백업·변경·재검증한다. 기존 리다이렉트는 보존하며 전체 Auth 응답/제공자 비밀값은 출력하지 않는다. 토큰은 해당 프로젝트 범위의 scoped PAT를 Git 제외 `.env.supabase.management.local`에만 저장한다. GET은 `auth_config_read`, PATCH는 `auth_config_write`와 `project_admin_write` 권한이 필요하다. 토큰을 채팅에 보내지 않는다.

```sh
node --import tsx scripts/supabase-auth-origin.ts --project-ref rujzymheazodvyprytgu --origin https://PUBLIC_IP:13000
# 조회 결과 검토 후에만 같은 명령 뒤에 --apply
```

## 푸시 서버 설정과 Android 실기기 수신 확인

서버에서 운영 VAPID 키를 생성하고 보호된 환경파일에 저장했다. 다시 적용했을 때 `changed:false`로 기존 키를 유지하는 것을 실제로 확인했다. 알림·영상 워커도 새 환경으로 재기동했고 두 진행 상태는 `healthy:true`다. 키는 출력하거나 PC·Git에 복사하지 않았다.

```sh
cd /opt/sliper/current/worker
/opt/sliper/runtime/node/bin/node --import tsx scripts/provision-production-push.ts --check --env-file /etc/sliper/runtime.env --subject https://PUBLIC_IP:13000
# 최초 미설정에만 --apply. 일부 누락/잘못된 기존 키는 임의 교체하지 않고 중단한다.
```

서버 점검에서는 실제 회원의 기기 구독이나 알림 발송을 대신 수행하지 않았다. 사용자가 Android Chrome에서 알림 권한 승인·기기 연결·테스트 요청을 진행했고, 휴대폰 알림 센터에 테스트 알림이 실제로 도착했다고 확인했다. 이 결과는 사용자 보고를 근거로 기록하며 기기 토큰·계정 세션을 수집하지 않았다. 검증한 Android 순서는 알림 켜기 → 기기 구독 → 테스트 알림이다. 남은 iPhone 실기기 검증은 홈 화면에 추가 → 홈 아이콘 실행 → 로그인 → 알림 허용 → 테스트 알림 수신 순서로 진행한다. 이전 HTTP 주소에서 만든 방문 상태와 새 HTTPS의 브라우저 권한은 별개다. 실제 기기에서 안내와 권한 승인이 필요하다.

## 이번 검증 결과

| 검사 | 결과 |
| --- | --- |
| 공인 인증서/외부 HTTPS | 예외 허용 없이 통과 |
| HTTP 업그레이드 |308, 경로·쿼리 보존 |
| 공개 화면·로그인·manifest·SW | 정상200 |
| 비회원 경계 |8/8, 보호 API401·환경파일404 |
| Chrome 모바일 크기/PC |7화면, JS 오류0·5xx0·가로 넘침0 |
| 브라우저 기능 | 보안 컨텍스트·Service Worker·Push API 사용 가능 |
| Google·Kakao 시작/복귀 | 각각303·Secure PKCE 쿠키, Supabase provider302 및 인증 취소 후 새 HTTPS로302 복귀 |
| 실제 소셜 로그인 | Google·Kakao 모두 사용자 성공 확인 |
| Service Worker 등록 | 격리 Chrome 모바일 크기에서 실제 등록·activated 확인, 권한 요청/구독/발송 없음 |
| 합성 프록시 검사 | 전달 헤더 위조 방어·Range206·SSE 즉시 전달·64MB 초과413·오류 로그 제거·보안 헤더 통과 |
| Android 실기기 푸시 | 테스트 알림의 실제 휴대폰 도착을 사용자 확인 |
| iPhone 실기기 푸시 | 미검증, 홈 화면 추가 후 별도 수신 확인 필요 |
| 운영 키 | 생성 후 재실행에서 재발급 없음 |
| 기존 서비스 | 설정 파일 해시/프로세스 유지, 기존 HTTPS 두 호스트200 |
| 로컬 코드 검사 | 새 설정 도구 테스트14개·배포 패키지 검사4개, 타입·포맷·비밀값 검사 통과 |

합성 프록시 검사는 실제 설정을 기반으로 별도 loopback 임시 서버에서 진행하고 종료 후 제거했다. 실제 회원 데이터·알림·신청을 변경하지 않았다. Chrome 모바일 크기 검사는 실물 Android/iPhone 수신 검사가 아니다. Android 테스트 푸시의 실제 도착은 사용자 확인을 받았지만, iPhone 수신과 실제 댓글·공지 이벤트에서 수신까지의 시나리오는 별도다. 다음 인증서 갱신, 부하·백업/분리 복원·장애 경보도 남아 있다. 상세 재현 결과와 접속 주소는 Git 제외 `.local/ncloud-https-*`와 `.local/ncloud-native-proxy-fixture.log`에 보관한다.

## 운영 점검과 복구

```sh
systemctl is-active sliper-web sliper-tls sliper-notifications sliper-video
curl --fail http://127.0.0.1:13001/api/health
curl --fail https://PUBLIC_IP:13000/api/health
journalctl -u sliper-tls -n 50 --no-pager
```

Caddy 설정을 수정하면 먼저 `caddy adapt`/`caddy validate`와 systemd 단위 검사를 수행한다. 관리자 API는 꺼져 있으므로 반영은 **sliper-tls만 재시작**한다. 기존 Nginx 설정은 바꾸지 않는다. 인증서 갱신 자체에는 수동 재시작이 필요 없다. 인증서 상태 폴더와 운영 VAPID 키를 지우거나 재생성하면 안 된다.

웹 릴리스 롤백에서는 HTTPS listener와 웹 loopback13001 drop-in을 유지하고 Sliper 릴리스만 전환한다. HTTPS를 완전히 철회해야 하면 TLS 서비스 중지, 해당 drop-in만 제거, `APP_ORIGIN`의 이전 HTTP 복구, Sliper 웹 재시작 순서로 진행한다. HTTP에서는 운영 로그인·푸시가 비활성 상태로 돌아간다. 이전 환경파일은 서버의 root 전용 백업으로 보존하며, 이후 추가된 키·설정을 검토 없이 덮어쓰지 않는다. 기존 사이트나 DB를 되돌릴 이유는 없다.


## 다음 출시 검증 순서

1. 암호화 백업을 실제 생성하고 서비스와 분리된 빈 환경에 DB·미디어를 복원해 확인한다. 현재 운영 DB를 복원 대상으로 사용하지 않는다.
2. 웹·알림·영상 워커 장애와 인증서 갱신 실패를 감지할 외부 경보·운영 대응을 확인한다. 자동 갱신 구성과 다음 실제 갱신 성공은 구분한다.
3. iPhone 실기기 수신과 실제 댓글·공지 발생 → 알림함 → 푸시 수신 시나리오를 점검한다. 테스트 푸시 성공만으로 전체 알림 유형을 검증 완료로 표시하지 않는다.
4. 기존 사이트를 유지하는 범위의 부하·자원 한도·재배포/롤백과 소규모 베타 운영을 검증한다.
