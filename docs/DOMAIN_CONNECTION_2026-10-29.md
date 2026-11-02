# sliper.kr 도메인 연결 — 2026-10-29

## 현재 적용 결과

- 정식 주소: **https://sliper.kr**
- `sliper.kr`, `www.sliper.kr` A 레코드는 `211.188.59.204`; 가비아 네임서버를 외부 DNS와 서버에서 확인했다.
- HTTP, www, 기존 IP의 브라우저 페이지는 경로·검색 조건을 유지해 정식 주소로 308 이동한다.
- 기존 IP의 `/api/*`, `/sw.js`, `/ops/health`는 유지해 기존 기기와 감시의 연결을 보존한다. 새 로그인·글쓰기 등은 정식 주소에서 사용한다.
- Let’s Encrypt 인증서 SAN에 sliper.kr·www.sliper.kr 포함. 만료는 **2027-01-26 22:59:41 한국 시간**이다.
- 사용자 승인 후 Sliper 웹·IP HTTPS 서비스만 재시작했고 Nginx는 구문 검사 후 graceful reload했다. 기존 Nginx 파일의 SHA256·마스터 PID·기존 앱 응답 200을 확인했다. 알림/영상 워커와 기존 사이트는 재시작하지 않았다.

## 연결 구조

```text
sliper.kr:443 → Nginx의 Sliper 전용 가상 호스트 → 127.0.0.1:13001 → Next.js
www.sliper.kr / HTTP → https://sliper.kr 로308
기존 IP:13000 브라우저 페이지 → https://sliper.kr 로308
sliper.kr/ops/health 또는 기존 IP/ops/health → 127.0.0.1:13002
기존 사이트 → 기존 Nginx 가상 호스트 → 기존 앱 :3000 (유지)
```

## 비밀 설정 보존

기존 `/etc/sliper/runtime.env`를 복사·수정하지 않았다. 전환 전후 SHA256이 같음을 검증했다. `/etc/sliper/domain.env`에는 공개 값 `APP_ORIGIN=https://sliper.kr`만 있고, `/etc/systemd/system/sliper-web.service.d/domain-origin.conf`가 기존 EnvironmentFile 뒤에 이 파일을 읽어 웹의 값만 덮어쓴다. 실제 실행 중인 웹 프로세스의 APP_ORIGIN이 정식 도메인임을 확인했다.

최초 반영안은 전체 비밀 환경파일 복사와 운영 변경 범위를 이유로 자동 승인 검토가 거절했다. 비밀 복제를 제거한 변경안에 대해 사용자가 **도메인 연결·인증서 자동 갱신 진행을 명시적으로 승인**한 뒤 적용했다.

## 인증서 자동 갱신

- Sliper 전용 Certbot: `/var/lib/sliper-domain-certbot/{config,work,logs}`. private key는 서버의 root 전용 디렉터리 안에 있고 채팅·저장소로 복사하지 않았다.
- HTTP-01 webroot: `/var/lib/sliper-domain-acme`.
- `sliper-domain-cert-renew.timer`: 하루 두 번 확인, 분산 지연, 부팅 시 미실행 일정 보완.
- `sliper-domain-cert-renew.service`: sliper.kr 인증서만 확인. 갱신 후 `/etc/sliper-domain/reload-nginx.sh`가 구문 확인 후 Nginx를 재로드한다.
- 실제 ACME staging 발급기관을 이용한 **갱신 모의 검사 통과**, 타이머 active, 서비스 Result=success. 다음 실제 운영 인증서 교체가 이미 일어났다는 의미는 아니다.
- 기존 사이트의 Certbot 설정·인증서·갱신 작업은 바꾸지 않았다.

정기 백업 자동화와 별도 보관처는 계속 사용자 보류 상태다. 인증서 갱신 타이머는 백업 작업이 아니다. 향후 수동 서버 복구 자료를 갱신할 때 새 도메인 설정과 위 Certbot 전용 경로도 포함해야 한다.

## 로그인 502 재현과 수정

도메인 전환 직후 사용자가 OAuth callback에서 Nginx 502를 보고했다. 실제 인증 코드는 재사용하거나 진단 요청에 넣지 않았다.

동일한 Sliper 가상 호스트 설정을 loopback 전용 Nginx에 복제하고, 별도 합성 서버가 로그인 응답과 유사한 여러 Set-Cookie 헤더를 반환하도록 검사했다.

| 검사 | 기존 설정 | 수정 후 |
| --- | --- | --- |
| 큰 합성 Set-Cookie 응답 | 502, 쿠키 0개 | 302, 쿠키 3개 보존 |
| 약10KB 합성 Cookie 요청 | 400 | 정상302 |
| 실제 도메인 health에 같은 가짜 큰 쿠키 요청 | 400 | 정상200 |

검증용 Nginx는 `upstream sent too big header`를 기록했고 실제 사용자 쿠키·토큰은 사용하지 않았다. Sliper 전용 설정에만 다음을 추가하고 Nginx 구문 검사·재로드했다.

- 요청: client_header_buffer_size 4k, large_client_header_buffers 4 16k.
- 응답: proxy_buffer_size 64k, proxy_buffers 8 32k, proxy_busy_buffers_size 128k.
- Nginx1.18의 HTTP/2도 별도 필드16KB·총64KB 한도를 지정했다. 실제 Chrome h2에서 합성 Cookie12KB는200. 18/24KB는 연결 초기화 대신 backend의 명시적인431을 반환한다. 앱의 기존16KB 요청 헤더 방어는 완화하지 않았다. Nginx1.19.7 이상으로 업그레이드하면 obsolete HTTP/2 지시어 대신 core 버퍼 설정을 검토한다.
- SSE/Range를 위한 proxy_buffering off, 원본 검사·Secure 쿠키·요청 본문64MB 제한은 유지한다.

502 당시 인증 코드가 이미 교환됐을 수 있으므로 기존 callback URL 새로고침이 아니라 **/login의 버튼에서 새 인증을 시작**하도록 안내했다. 수정 후 사용자가 새로 인증을 시작하니 로그인된다고 확인했다. 제공자 종류는 별도로 명시하지 않았으며, 이 사용자 확인과 두 제공자의 자동 시작·복귀 검사는 구분해 기록한다.

## 완료한 검증

- HTTPS 연결: 정상 신뢰 검증으로 apex health200, www308, IP 브라우저308.
- 도메인과 IP의 ops/health 모두200. 사용자가 BetterStack 모니터 URL을 `https://sliper.kr/ops/health`로 변경했다고 확인했다. 변경 후 도메인 감시 주소200을 다시 확인했고 기존 IP 감시 주소도200을 유지한다.
- Google·Kakao: 시작303, Secure PKCE 쿠키, 새 도메인 callback 지정. Supabase→각 제공자302 및 로그인 전 의도적인 취소→정식 도메인 callback302 복귀 확인. 실제 계정 로그인 완료 검사는 별도다.
- 새 도메인 네이버 인증·지도 타일·모바일 장소 검색·Geocoding 주소 결과·가로 넘침 검사7개 통과. 자동 위치 검사는 공개 테스트 좌표를 사용했다.
- PC·모바일 주요5화면씩 총10화면 정상200, 가로 넘침·페이지 JS 예외·애플리케이션 API5xx 없음.
- 새 도메인 서비스 워커 activated, secure context, PushManager 사용 가능. 실제 도메인 푸시 수신은 사용자가 지금 확인하기 어렵다고 답해 미확인으로 둔다.
- 회원 전용 API401·비밀파일404·외부 Origin 거절·전달 헤더 위조 방어 검사7개 통과.
- native 패키징 검사4개·실제 allowlist 압축/해시 검사와 Git-visible 비밀값 검사 통과. 앱 소스를 바꾸거나 재빌드하지 않았으며 직전 전체1,094개 결과는 이전 지도 수정본의 기록이다.

## 운영 파일

- `deploy/native/sliper-domain.nginx.conf` → `/etc/nginx/conf.d/sliper-domain.conf`
- `deploy/native/sliper-domain-origin.conf` → `/etc/sliper/domain.env` (공개 URL만 포함)
- `deploy/native/sliper-web-domain.conf` → 웹 systemd drop-in
- `deploy/native/sliper-domain-cert-renew.service`, `.timer`
- `deploy/native/sliper-domain-reload-nginx.sh`

## 사용자 확인·남은 작업

- 도메인 로그인 재시도 성공: 사용자 확인 완료. 구글·카카오별 구분 없이 받은 성공 확인으로 기록한다.
- 정식 도메인에서 본인 기기의 알림 수신 다시 허용·테스트: 미확인. IP에서 승인한 브라우저 권한·로그인 쿠키는 다른 원본 도메인으로 자동 이동하지 않는다.
- BetterStack 모니터 URL 변경: 사용자 완료 확인. 기존 이메일 수신·정상200 설정을 유지하며 도메인 감시 응답200을 확인했다.
- 카메라 실기기·테스트 일정 변경은 사용자 요청으로 보류. iPhone 기기는 없어 미검증. 정기 백업 자동화·별도 보관처 보류도 유지한다.


재현 근거: Git 제외 `.local/ncloud-domain-header-test.log`, `.local/sliper-domain-http2-header-check.json`, `.local/sliper-domain-boundary-check.json`, `.local/sliper-domain-browser-check.json`, `.local/sliper-domain-map-check.json`에 비밀값 없는 결과를 보관한다.
