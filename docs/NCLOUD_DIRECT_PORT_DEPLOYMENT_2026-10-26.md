# 기존 Ncloud 별도 포트 배포 결과 — 2026-10-26

> 2026-10-27 후속: 현재13000은 공인 IP HTTPS와 HTTP308 자동 전환을 사용하며 웹 내부 포트는127.0.0.1:13001이다. 운영 VAPID도 설정했다. [최신 연결 상태와 남은 사용자 설정](NCLOUD_IP_HTTPS_2026-10-27.md). 아래는 최초 HTTP 배포 당시의 기록이다.

실제 서버의 Sliper 웹·알림·영상 서비스를 기동했다. **서버 내부와 외부13000 접속 모두 정상이다.** 사용자의 ACG 규칙 추가 후 외부 응답과 공개 화면을 재검증했다. 현재는 HTTP 미리보기이며 HTTPS·운영 인증·푸시는 후속이다. 공인 IP·SSH 접속 상세와 원격 로그는 Git 제외 .local에 보관한다.

## 이번에 실제로 반영한 작업

- 기존 서버: Ubuntu 20.04.6, x86_64, kernel 5.4, glibc 2.31, 2 vCPU·RAM 약8GB·디스크 약36GB 여유 확인.
- 기존 사이트: Node20.19.0/PM2와 Nginx80·443, Node3000을 유지했다. 기존 서비스 응답은 작업 전·빌드 중·기동 후 모두 HTTP200이었다.
- Sliper: Node24.22.1을 공식 배포 SHA256과 대조해 /opt/sliper/runtime에 별도 설치했다. /usr/bin/node와 기존 PM2·Nginx 설정은 변경하지 않았다.
- 전용 비로그인 sliper 계정을 만들고, 권한을 분리한 소스·상태·런타임 환경파일을 준비했다.
- 배포 소스는 560개 허용 파일의 SHA256을 보존한 아카이브로 전송하고 추출 후 전수 대조했다. .env·키·Git·사용자 업로드·Windows 의존성은 소스 묶음에서 제외했다.
- 실제 Linux 의존성 설치·운영 빌드는 sliper 계정의 systemd 일회성 작업으로 CPU1개·메모리4GB 한도와 낮은 우선순위를 적용했다.
- 웹·알림·영상의 전용 systemd 서비스를 부팅 시 자동 실행하도록 등록했다. 웹은 **0.0.0.0:13000**에서 실행한다.

기존 사이트의 도메인 정보는 사용하지 않았다. 기존 서비스의 포트·DNS·인증서·프록시 설정도 바꾸지 않았다.

## 현재 서버 경로

| 경로/서비스 | 용도 |
| --- | --- |
| /opt/sliper/runtime/node | Sliper 전용 Node24 |
| /opt/sliper/releases/20261026-direct-01 | 현재 릴리스 |
| /opt/sliper/current | 현재 릴리스 선택 링크 |
| current/standalone | 웹 운영 산출물 |
| current/worker | Linux에서 설치한 워커 소스/의존성 |
| /etc/sliper/runtime.env | 제한 DB 역할·private Storage 등 서버 설정, root:sliper0640 |
| /var/lib/sliper/web-cache | 웹 캐시, Sliper 소유 |
| /run/sliper-web, /run/sliper-notifications, /run/sliper-video | 서비스별 임시 경로·진행 상태 |
| sliper-web / sliper-notifications / sliper-video.service | 이번에 추가한 세 서비스 |

환경파일은 마이그레이션·백업 관리자 키와 로컬 테스트 인증 설정을 제외한 허용 항목만 전달했다. 광고·결제 자동화·VAPID 미설정 기능을 임의로 활성화하지 않았다. 원격 전송용 임시 runtime.env는 설치 뒤 제거했다. 현재 native 실행의 로그는 journald를 사용한다. 앞선 Docker json-file 회전 설정과 구분한다.

## 실제 검증

| 검사 | 결과 |
| --- | --- |
| 전용 SSH 키 로그인 | 성공. 비밀번호를 채팅·스크립트·로그에 저장하지 않음 |
| 운영 빌드/서버 추적 | 성공, 추적117개·워커 의존성/비밀파일/오류0 |
| 웹 산출물 감사 | 2,740파일·금지 파일0·예상 밖 링크0. 허용 캐시 링크1개 |
| Supabase 연결 | 실행 역할로 DB 연결·비공개 버킷 확인, 로컬 미디어 참조0 |
| 실제 native 영상 압축 | UID998, FFmpeg·FFprobe 실행, 합성320×180 MP4 → 2,468바이트. 실제 회원 파일 사용 없음 |
| 서버 내부 생존/홈/목록 API | 생존 status=ok, 홈200, 글 목록 API200 |
| 워커 | 알림·영상 healthy=true, 세 서비스 재시작 횟수0 |
| 기존 사이트 | Node20.19.0 유지, 기존 프로세스 유지, HTTP200·Nginx active |
| 외부13000 | ACG 추가 후 생존·홈·이야기·번개·아카이브·플레이어6경로 모두200 |
| 브라우저 | 모바일 크기5화면·PC2화면, 페이지 오류0·5xx0·가로 넘침0. 변경 API 차단, 실기기·실제 로그인 미검증 |
| 비회원 경계 | 8/8: 보호 API401, .env/.env.production404. 인증 세션 없음·로컬 계정 사용 불가 |

DB 마이그레이션·seed·회원/게시물 복원은 이번 배포에서 실행하지 않았다. 기존 Supabase 데이터와 권한 정책을 그대로 사용한다. 외부 HTTP 주소에서는 운영 인증을 허용하지 않는 기존 정책을 유지한다.

## 반영된 외부 포트와 확인 절차

사용자가 Ncloud 콘솔의 ACG Inbound에 TCP13000 허용 규칙을 추가했고, 외부 접속 성공을 확인했다. 이후 점검/재배포 시에도 해당 NIC의 다음 규칙을 확인한다.

| 항목 | 값 |
| --- | --- |
| 프로토콜 | TCP |
| 접근 소스 | 공개 웹 접속을 위한 0.0.0.0/0, 초기 운영자 테스트만이면 운영자 IP/32 |
| 허용 포트 | 13000 |

기존 규칙을 제거하지 않는다. 이미 허용되어 있다면 해당 NIC에 실제 연결된 ACG와 Subnet Network ACL도 확인한다. 서버 내부 정상만으로 외부 접속 성공을 표시하지 않는다. [Ncloud ACG](https://guide.ncloud-docs.com/docs/server-acg-vpc).

## 운영 명령

```sh
systemctl is-active sliper-web sliper-notifications sliper-video
journalctl -u sliper-web -n 50 --no-pager
curl --fail http://127.0.0.1:13000/api/health

cd /opt/sliper/current/worker
runuser -u sliper -- env TMPDIR=/run/sliper-notifications /opt/sliper/runtime/node/bin/node --import tsx scripts/worker-health.ts notification
runuser -u sliper -- env TMPDIR=/run/sliper-video /opt/sliper/runtime/node/bin/node --import tsx scripts/worker-health.ts video
```

단일 앱 재시작은 해당 Sliper 서비스만 대상으로 한다. 기존 사이트의 PM2 프로세스나 Nginx를 재시작할 필요가 없다. 첫 배포이므로 아직 되돌릴 이전 Sliper 릴리스는 없다. 이후에는 검증된 이전 릴리스 링크로 전환하고 Sliper 세 서비스만 재시작한다. 앱 되돌리기와 DB 복원은 별도다.

## 다음 연결 단계

1. 외부 홈·API와 모바일 크기·PC 화면 검증 완료. 실제 Android/iPhone 조작 검증은 남아 있다.
2. Sliper 자체 HTTPS를 설정하고 Supabase 허용 복귀 URL·로그인을 검증한다. 기존 사이트의 도메인은 필요하지 않다.
3. VAPID 연락 URI·키와 Android/iPhone 푸시를 연결한다.
4. 실제 백업/분리 복원·정기 정리·장애 경보·부하와 기존 OS 보안 지원 상태를 점검한다.

공인 IP 인증서도 가능한 선택이다. 다만 Let’s Encrypt IP 검증은80/443의 검증 경로가 필요하므로 별도 검토 없이 기존 Nginx 설정을 바꾸지 않았다. 기존 프록시를 전혀 사용하지 않는 인증 방식은 Sliper 자체 도메인과 DNS 검증 같은 대안을 선택할 수 있다. [Let’s Encrypt IP 인증서](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability), [검증 방식](https://letsencrypt.org/docs/challenge-types/).

이번에 외부 HTTP 접속은 확인했다. 운영 로그인·실기기 푸시·원격 복원은 아직 완료하지 않았다. [기존 인스턴스 배포 안내](NCLOUD_EXISTING_INSTANCE.md), [native 서비스 템플릿](../deploy/native/README.md).

공개 검증은 GET/HEAD와 변경 요청을 차단한 브라우저 세션으로 수행했다. 실제 회원의 신청·댓글·알림 상태를 변경하지 않았다. 재현 결과는 Git 제외 .local/ncloud-external-pages.json, ncloud-public-browser.json, ncloud-public-boundary-check.json, ncloud-post-acg-health.log에 보관한다.
