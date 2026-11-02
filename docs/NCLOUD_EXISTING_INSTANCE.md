# 기존 Ncloud 인스턴스에서 Sliper를 별도 포트로 운영하기

> 2026-10-27 실제 배포: 이 서버에는 Docker를 추가하지 않고 전용 Node/systemd로 배포했다. 외부13000의 공인 IP HTTPS가 정상이며 기존 사이트는 유지했다. 실행 중인 환경의 명령은 [최신 결과](NCLOUD_IP_HTTPS_2026-10-27.md)를 따른다. 아래 Compose 절차는 대안 구성 안내이며 현재 서버에 그대로 실행하지 않는다.

기준일: 2026-10-26. 사용자는 같은 인스턴스에서 기존 서비스와 Sliper를 서로 다른 외부 포트로 운영하기로 했다. **기존 서비스의 도메인 주소는 이 방식의 필수 정보가 아니다.** 아직 SSH 인증·원격 포트 점유·여유 자원을 확인하지 않았으며, 원격 방화벽이나 실행 중인 서비스를 변경하지 않았다.

## 선택한 연결 방식

```text
서버 공인 IP:기존 포트 → 기존 서비스
서버 공인 IP:13000    → Sliper 웹 컨테이너:3000
                       + Sliper 알림/영상 워커
```

13000은 예시다. SSH 접속 후 비어 있는 포트를 확인하고 해당 포트만 Sliper에 배정한다. 기존 서비스의 포트·DNS·프록시 설정을 바꿀 필요는 없다. 컨테이너 안에서는 계속3000을 사용한다.

다음 설정은 Sliper 호스트 포트를 직접 게시한다. 기본값은127.0.0.1이며 직접 외부 접속을 선택한 배포에서만0.0.0.0을 지정한다.

```dotenv
SLIPER_BIND_ADDRESS=0.0.0.0
SLIPER_BIND_PORT=13000
```

**외부 HTTP 포트 접속과 정식 로그인·푸시 완료는 별도 단계다.** 현재 [auth-config.ts](../src/server/auth-config.ts)는 localhost/127.0.0.1 외의 HTTP 원본을 운영 인증에 허용하지 않는다. 이 정책이나 secure 쿠키를 완화하지 않는다. `http://서버IP:13000`에서는 우선 웹 생존·공개 화면 연결을 확인하며, 전체 서비스 공개 전에 Sliper 자체의 신뢰할 수 있는 HTTPS 주소와 인증서를 연결한다. 기존 서비스의 도메인을 재사용할 필요는 없다. `APP_ORIGIN`·OAuth 복귀 주소·푸시는 확정한 Sliper HTTPS 주소에 맞춘다.

기존 `compose.https.yaml`은80/443을 게시하는 구성이다. **이번 별도 포트 배포에 자동으로 덧붙이지 않는다.** Sliper의 HTTPS를 별도 외부 포트에서 운영할 때는 그 포트와 인증서 발급 방식을 확인한 별도 TLS 구성을 사용한다. 아래 기존 프록시 예시는 사용자가 추후 공유 프록시 방식을 선택할 때만 참고한다.

## 비밀번호 접속에서 배포용 SSH 연결 준비

현재 PC에 전용 SSH 키를 사용자만 읽을 수 있는 .ssh/sliper-deploy에 준비했다. 개인키는 프로젝트나 이미지에 넣지 않는다. 다음 도우미는 기존 SSH 접속 비밀번호를 OpenSSH 콘솔에서 직접 입력받는다. 비밀번호를 채팅·인자·로그·파일로 저장하지 않는다.

```powershell
# 현재 PC의 일반 PowerShell에서 실행한다.
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Sliper\scripts\connect-ncloud.ps1"
```

기존 SSH 계정이 root가 아니라면 -SshUser 옵션으로 실제 계정을 지정한다. 스크립트는 배포용 공개키를 기존 authorized_keys 끝에 중복 없이 추가하고, 자원·포트 점검 뒤 키 로그인이 되는지 확인한다. 기존 키를 덮어쓰거나 비밀번호 로그인·방화벽·서비스 설정을 변경하지 않는다. 기본 authorized_keys 경로가 symlink이면 확인 없이 수정하지 않는다.

- -Preview 옵션은 서버에 접속하지 않고 작업 범위·공개키 지문을 보여준다.
- 검토용 원격 스크립트는 Git 제외 .local/ncloud-ssh-bootstrap.review.sh에 생성한다.
- 고정된 서버 호스트키 검증을 유지한다. 키가 바뀌면 자동으로 무시하지 않는다.
- 키 등록 후 검증이 실패해도 등록 사실과 실제 변경 범위를 로컬 상태에 별도로 보관한다.
- 완료 문구 SLIPER_SSH_READY=1을 확인한 뒤 배포를 이어간다. 이 단계는 아직 웹 서비스 배포나 포트 개방 완료가 아니다.

PowerShell 구문·미리보기, Windows PowerShell 5.1의 인자/표준입력 보존, 생성한 Bash 스크립트 문법을 검증했다. 실제 비밀번호 입력과 원격 키 등록은 사용자가 위 명령을 실행할 때 이루어진다.

## 먼저 확인할 항목

- SSH 접속 사용자와 방법, OS·CPU·메모리·디스크 여유
- 기존 서비스의 실제 포트와 Sliper 후보 포트의 점유 여부
- Ncloud ACG/서버 방화벽의 Sliper 전용 TCP 포트 규칙
- Sliper 전용 디렉터리·Compose 프로젝트명·릴리스 태그 충돌 여부

Compose 기본 프로젝트 이름은 `sliper-cloud`다. 같은 이름의 기존 프로젝트가 있다면 별도 이름을 정하고 이후 기동·상태·중지 명령에 일관되게 사용한다. 웹1GiB·알림512MiB·영상2GiB는 상한이며, 기존 서비스와 빌드가 사용할 여유도 실제로 확인한다.

읽기 전용 [existing-host-preflight.sh](../scripts/existing-host-preflight.sh)는 환경변수·개인키·프록시 전체 설정을 출력하지 않고 OS·자원·포트·프록시 실행 파일·컨테이너 이름/이미지/포트를 조회한다.

```sh
bash scripts/existing-host-preflight.sh 13000
```

## Sliper 설정과 기동

Sliper 전용 `.env.production`의 서버/DB·Storage 설정을 준비하고 위의 주소·포트를 지정한다. 기존 앱의 환경파일을 사용하지 않는다. `SLIPER_BIND_ADDRESS` 기본값은127.0.0.1, `SLIPER_BIND_PORT` 기본값은3000이다. [운영 환경 예제](../production.env.example)에는 실제 비밀값이 없다.

```sh
# Sliper 소스 디렉터리에서, 서버 자원·포트 검토 후 실행한다.
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --pull never
curl --fail http://127.0.0.1:13000/api/health
```

직접 외부 접속을 허용할 때는 Ncloud ACG에서 선택한 TCP 포트만 추가하고 접속 원본 범위도 정한다. 초기 연결 검사는 운영자 IP로 제한할 수 있다. 기존 ACG/SSH/다른 서비스 규칙을 지우지 않는다. Docker 게시 포트와 OS 방화벽의 관계도 실제 실행 구성에서 확인한다. [Ncloud ACG](https://guide.ncloud-docs.com/docs/server-acg-vpc), [Docker 방화벽 주의점](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

서버 내부 생존 확인 후 외부의 `http://SERVER_PUBLIC_IP:13000/api/health` 응답을 확인한다. 이 응답은 DB·인증·푸시의 준비 완료를 의미하지 않는다. `docker compose config` 전체에는 실제 환경값이 포함될 수 있으므로 공유할 때는 `--quiet`를 사용한다.

## 선택 사항: 추후 기존 HTTPS 프록시를 공유하는 경우

아래는 독립 포트 방식의 필수 절차가 아니다. 추후 사용자가 hostname 기반 공유 프록시를 선택할 때의 예시다. 이 경우에만 바인딩을127.0.0.1로 유지하고 프록시에서 Sliper 내부 포트로 전달한다.

### 호스트 Nginx 예시

다음은 **호스트에 직접 설치된 Nginx**의 별도 Sliper server 블록 예시다. 실제 hostname과 이미 준비한 인증서 경로로 치환하고, 기존 설정 백업·충돌 검사 후 반영한다. 인증서는 기존 서버의 발급·자동 갱신 도구를 확인해 준비한다. 이 예시를 그대로 기존 전체 설정 파일에 덮어쓰지 않는다.

```nginx
server {
    listen 443 ssl;
    server_name sliper.your-existing-domain.example;

    ssl_certificate /PATH/TO/SLIPER/fullchain.pem;
    ssl_certificate_key /PATH/TO/SLIPER/privkey.pem;
    client_max_body_size 64m;
    client_body_timeout 120s;
    # OAuth query strings must not be retained in access logs.
    access_log off;

    location / {
        proxy_pass http://127.0.0.1:13000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 90s;
        proxy_send_timeout 120s;
    }
}
```

이 예시는 프록시가 공인 요청을 직접 받는 경우다. 앞에 별도 로드밸런서나 신뢰 프록시가 있다면 전달 IP·HTTPS 처리 규칙을 그 구성에 맞춰 확인한다. Nginx 오류 로그도 OAuth 코드·쿠키·Authorization을 보관하지 않도록 별도로 검토한다. access_log off가 오류 로그의 민감값 제거까지 보장하지 않는다.

설정은 `nginx -t`로 검사한 뒤 기존 서버의 관리 방식으로 reload한다. 기존 사이트와 Sliper의 HTTPS·영상 Range·공지 SSE를 각각 확인한다. [Nginx proxy 지시문](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

### 호스트 Caddy 예시

다음 Sliper site 블록을 기존 Caddyfile에 추가한다. 기존 global 설정과 다른 사이트 블록은 유지한다. 실제 소유한 hostname의 DNS와 80/443 도달·기존 인증서 정책을 확인한 후 활성화한다.

```caddyfile
sliper.your-existing-domain.example {
    request_body {
        max_size 64MB
    }
    reverse_proxy 127.0.0.1:13000 {
        flush_interval -1
        transport http {
            dial_timeout 5s
            response_header_timeout 90s
        }
    }
}
```

기존 Caddy 서비스의 로그 필터·인증서 볼륨·권한을 함께 확인한다. `caddy validate --config /etc/caddy/Caddyfile`로 검증한 뒤 해당 서비스가 사용하는 reload 절차를 따른다. Caddy 관리 API를 꺼둔 서버는 일반적인 API 기반 reload가 동작하지 않을 수 있으므로 실행 방식을 먼저 확인한다. [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

### Docker 프록시를 공유할 때

프록시 컨테이너 안의 `127.0.0.1`은 그 프록시 컨테이너 자신이다. 위 호스트 프록시 예시를 그대로 적용하지 않는다. 기존 프록시의 네트워크를 확인하고 두 Compose가 공유할 명시적 external 네트워크·고유한 Sliper upstream alias를 준비한다. 컨테이너 간에는 Sliper의 내부3000으로 전달하며 외부 호스트 포트 공개를 늘리지 않는다. 실제 네트워크 이름과 기존 서비스 소유권을 확인하기 전에 임의의 network connect나 기존 서비스 재생성을 실행하지 않는다.

## Sliper 공개 주소 확정 뒤

1. Sliper 전용 HTTPS 주소·인증서와 APP_ORIGIN을 확정한다. 별도 외부 포트라면 주소에 포트도 포함한다.
2. Supabase 허용 콜백·네이버 지도 허용 주소를 Sliper 주소에 맞춘다.
3. 두 회원의 로그인·신청·승인·공지·영상과 Android/iPhone 알림을 검증한다.
4. 기존 서비스의 응답과 자원 사용량도 다시 확인한다.

전체 백업·운영·되돌리기 절차는 [Ncloud 실행 구성 준비](NCLOUD_RUNTIME_PREPARATION_2026-10-26.md)를 참고한다.

## 이번 검증 범위

실제 비밀값 없이 Compose 설정 검사로 기본127.0.0.1:3000, 내부127.0.0.1:13000, 직접 외부0.0.0.0:13000 바인딩을 확인했다. 컨테이너 내부와 생존 점검은3000이다. 이 검사는 실제 서버의 포트 개방·점유·방화벽이나 HTTPS를 확인한 결과가 아니다. 원격 서비스 변경은 수행하지 않았다.

읽기 전용 점검 스크립트는 Bash 문법과 격리 모의 검사8개를 통과했다. 실제 원격 점검은 SSH 인증 후 진행한다.
