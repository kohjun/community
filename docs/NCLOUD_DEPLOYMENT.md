# Ncloud · sliper.kr 배포 실행 순서

> **2026-10-26 후속:** HTTPS Compose·Node 24 Linux 이미지·진행 기반 워커 상태 점검·원격 백업 사전 검사를 보완했다. 아래에는 당시 검증 기록이 포함된다. 최신 명령과 검증 범위는 [Ncloud 실행 구성 준비](NCLOUD_RUNTIME_PREPARATION_2026-10-26.md)를 참고한다.

기준: 2026-10-16. Ncloud 서버 예산 약 월8만 원과 예정 도메인 `sliper.kr`은 사용자가 선택했다. 사용자가 서버 미생성을 확인했다. OS·사양·SSH 접속은 신규 생성 단계에서 정하며 도메인도 아직 구매하지 않았다. 이 문서는 실행 계획으로, Ncloud 서버나 도메인·유료 DNS를 생성/구매한 결과가 아니다.

## 1. 사용할 구성

```text
https://sliper.kr
  → Ncloud 공인 IP :443
  → 호스트 HTTPS 프록시
  → 127.0.0.1:3000 Next.js 웹 컨테이너

같은 Ncloud 서버: 알림 워커 + 영상 워커
저장·인증·공지 갱신: 기존 Supabase DB / Auth / private Storage / Realtime
```

기존 `compose.production.yaml`은 웹·영상·알림만 포함하므로 **HTTPS 프록시는 추가 설정해야 한다**. Dockerfile·Compose 준비가 도메인 HTTPS 발급 완료를 뜻하지 않는다. 초기 서버 한 대는 재시작/장애 때 웹과 워커가 함께 중단되는 구조다. DB와 파일은 Supabase에 남고 작업은 원장에서 복구하지만 무중단 다중 서버 구성은 아니다.

신규 서버라면 Ubuntu 24.04 LTS x86_64를 우선 검토한다. 이미 생성한 서버가 있으면 OS·CPU·RAM·디스크를 확인한 뒤 기존 환경을 활용한다. 현재 컨테이너 메모리 상한 합은 웹1GiB + 알림512MiB + 영상2GiB이며 여기에 OS·프록시·빌드 메모리가 필요하다. 상한은 실제 사용량과 다르다. RAM8GiB를 우선 검토하되 예산·정확한 사양과 빌드/영상 부하를 확인한 뒤 선택한다. 견적을 확인하기 전 특정 사양이8만 원 안에 들어간다고 보장하지 않는다.

## 신규 서버 생성 시 입력 기준

Ncloud 콘솔에서 한국 리전·VPC 환경을 선택하고 `Compute → Server → 서버 생성 → 신규 콘솔`로 이동한다. VPC/Subnet이 없으면 먼저 만든다. 이 초기 구성에서는 공인 IP를 할당할 수 있는 Public Subnet을 선택한다. 기존 네트워크가 있다면 중복 CIDR을 임의로 만들지 않는다.

| 항목           | 검토할 초기 값                                                                           |
| -------------- | ---------------------------------------------------------------------------------------- |
| 서버 이미지    | Ubuntu 24.04 LTS, x86_64, KVM/g3와 호환되는 일반 OS 이미지                               |
| 서버 타입      | Standard, vCPU2개·RAM8GB부터 검토                                                        |
| 서버 이름/개수 | `sliper-web-01`, 1대                                                                     |
| 스토리지       | 기본 디스크50GB부터, 볼륨별 요금 확인                                                    |
| 공인 IP        | 할당                                                                                     |
| 요금제         | 테스트·사양 조정 기간에는 시간 요금부터 검토. 장기 약정은 운영 사용량 확인 후 결정       |
| 인증키         | 새 키를 발급해 안전한 로컬 경로에 보관. 관리자 비밀번호 확인용으로 필요                  |
| ACG            | `sliper-web-acg` 등의 전용 그룹. TCP22는 운영자 공인 IPv4/32, TCP80·443은 웹 접속에 허용 |
| 반납 보호      | 운영 시작 전 활성화                                                                      |

Standard g3의2vCPU·8GB 구성은 공식 서버 사양에 존재한다. 이것이 월8만 원 이내라는 가격 확정은 아니다. 콘솔의 서버·스토리지·공인 IP 예상액과 세금·사용량 요금을 확인한다. 선택 상품의 실제 월 환산 비용을 확인하지 않고 장기 약정이나 추가 유료 서비스를 생성하지 않는다.

생성 후 서버 목록이 `운영중`인지 확인하고 OS·사양 코드·공인 IP를 기록한다. 인증키 파일 내용이나 관리자 비밀번호를 채팅에 보내지 않는다. 관리 비밀번호는 Ncloud 콘솔에서 본인이 확인하고, 이후 SSH 키 접속을 별도로 구성한다. 아직 구매하지 않은 `sliper.kr`로 현재 로컬 APP_ORIGIN을 먼저 바꾸지 않는다.

서버 생성 직후 이어갈 순서는 **SSH 접속 확인 → Docker/Compose 설치 → 이미지 빌드·워커 기동 → 도메인 DNS → HTTPS → 운영 로그인·파일·공지·푸시 검증**이다. 서버가 준비되기 전에는 실제 배포 명령을 실행하지 않는다.

공식 사양/생성 기준: [서버 사양](https://guide.ncloud-docs.com/docs/server-spec-vpc), [신규 콘솔 서버 생성](https://guide.ncloud-docs.com/docs/server-create-vpc).

## 2. 서버와 접속 준비

1. Ncloud 콘솔에서 기존 인스턴스가 있는지 확인한다. 신규 생성은 VPC·Subnet·이미지·사양·인증키·네트워크 접근 설정 순서로 진행한다.
2. 공인 IP와 ACG/Network ACL 접근 규칙을 확인한다. 이 계획은 공인 IP로 직접 HTTPS를 받는 초기 단일 서버 구성을 전제로 한다.
3. 인바운드는 웹용80/443, SSH는 운영자 공인 IP에만 허용하는 구성을 준비한다. 웹 컨테이너의3000 포트는 기존 Compose처럼127.0.0.1에만 둔다.
4. SSH 호스트 별칭/설정 파일과 사용자를 확인해 접속한다. 관리자 비밀번호·SSH 개인키·Ncloud API Secret을 채팅이나 저장소에 넣지 않는다. Ncloud 인증키 파일을 가지고 있다는 것만으로 일반 SSH 키 인증 설정이 완료됐다고 가정하지 않는다.
5. Linux에서 Docker Engine·Compose 플러그인을 준비하고 실제 웹/FFmpeg 이미지 빌드·실행을 검증한다. OS 설치나 기존 서버 설정 변경은 접속 환경을 확인한 뒤 수행한다.

공식 안내: [서버 생성](https://guide.ncloud-docs.com/docs/server-create-vpc), [공인 IP·ACG와 서버 접속](https://guide.ncloud-docs.com/docs/server-access-vpc), [ACG](https://guide.ncloud-docs.com/docs/server-acg-vpc).

## 3. 도메인과 HTTPS

1. 도메인 등록기관에서 `sliper.kr`의 등록 가능 여부를 확인하고 본인 명의/계정으로 구매한다. Global DNS는 도메인 등록·갱신 대행 기능이 아니므로 도메인 구매와 DNS 운영을 구분한다.
2. 도메인 DNS의 `sliper.kr` A 레코드를 Ncloud 서버 공인 IPv4에 연결한다. `www`도 사용할 때만 별도 레코드와 리다이렉트를 추가한다.
3. Ncloud Global DNS를 선택했다면 도메인 추가 → 레코드 입력 → 설정 적용 후, 등록기관의 네임서버를 Ncloud가 안내한 값으로 맞춘다. 등록기관 DNS를 계속 사용한다면 불필요하게 네임서버를 옮기지 않는다.
4. DNS가 올바른 IP로 응답하고80/443이 도달하는지 확인한 뒤, HTTPS 프록시와 인증서 발급·자동 갱신을 설정한다. SSE 지연 없이 전달되는지와 영상50MiB 원본의 요청 크기/시간도 확인한다.
5. 공개 주소와 인증서가 준비된 배포 환경에서 `APP_ORIGIN=https://sliper.kr`을 적용한다. 현재 PC의 정상 로컬 설정을 미구매 도메인으로 먼저 바꾸지 않는다.

공식 안내: [Global DNS 역할과 도메인 구매 구분](https://guide.ncloud-docs.com/docs/globaldns-overview), [도메인·A 레코드·설정 적용](https://guide.ncloud-docs.com/docs/globaldns-record).

## 4. 앱과 공급자 설정

- 배포할 소스 버전을 고정하고 비밀값 검사를 실행한다. `.env`·`.env.supabase.local`·`.local`은 전송 소스/이미지에서 제외한다.
- `production.env.example`을 참고해 배포 서버의 보호된 `.env.production`을 채운다. 기존 Supabase 제한 실행 DB·private 버킷·서버 키를 사용하고 마이그레이션 소유자 키는 배포하지 않는다.
- 웹·영상·알림을 같은 Supabase 프로젝트에 연결한다. 공개 식별자만 웹 빌드 인자로 넘긴다.
- Supabase Auth Site URL/허용 Redirect URLs를 `https://sliper.kr`과 정확한 `/auth/callback` 경로에 맞춘다. 구글·카카오의 Supabase 공급자 콜백은 기존 프로젝트 주소를 유지하며 콘솔의 웹 원본 등 필요한 항목을 함께 확인한다.
- NAVER Maps 허용 도메인을 설정하고 VAPID 키·실제 연락 URI를 준비한다. 기존 사용 중인 VAPID를 임의 교체하지 않는다.
- AdSense는 사이트 심사·광고 단위가 준비될 때까지 비활성화한다. 결제 자동화는 제공자를 정하고 실제 거래 검증 후 연다.

## 5. 실제 배포 검증과 제한 베타

우선 Linux에서 이미지3개를 빌드/기동하고 재시작을 검증한다. 이후 공개 HTTPS에서 두 회원의 로그인 → 사진/영상 글 → 무료 신청 또는 외부 수동 승인 → 공지 → QR → 종료/회고/포트폴리오를 확인한다. 비회원·타인·취소 회원의 페이지/API/미디어 접근을 함께 검사한다.

정기 파일 정리·백업/분리 복원·워커 감시·로그 보관/회전·장애 알림·문의 담당을 준비하고 Android/iPhone 실기기와 동시 신청 부하를 확인한 뒤 소수 인원에게 공개한다. 운영 서버에서 사용하는 프록시/로그/스케줄 설정은 아직 배포하지 않았다.

전체 남은 기능·검증: [출시 계획](RELEASE_PLAN_2026-10-16.md). 환경변수·컨테이너 명령: [Supabase 클라우드 실행 가이드](SUPABASE_CLOUD_RUNTIME.md).
