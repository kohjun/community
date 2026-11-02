# Ncloud Sliper 디스크 정리 완료 보고서

- 작업일: 2026-10-31 KST
- 승인: 사용자의 “응 검사하고 정리해줘”에 따라 사전 보고서에 명시한 20개 경로만 정리.
- 서비스 중지·재시작, current 링크 전환, Nginx 설정 변경, DB 접근·수정 없이 완료.

## 결과

| 항목 | 정리 전 | 정리 후 |
|---|---:|---:|
| 디스크 사용률 (`df`) | 95% | **38%** |
| 사용 용량 | 43.703 GiB | 17.247 GiB |
| 가용 용량 | 2.744 GiB | **29.201 GiB** |
| 릴리스 개수 | 23개 | 3개 |
| releases 용량 (`du`) | 31.766 GiB | 5.309 GiB |

실제 파일시스템 사용량 감소는 **26.457GiB (28,407,914,496 bytes)**다. 후보별 du 합계와 약 24KiB 차이가 나며, 작업 중 로그·감시 상태 등의 정상 쓰기 때문에 발생할 수 있다.

## 보존 확인

| 릴리스 | 보존 이유 | 용량 GiB |
|---|---|---:|
| `20261028-map-cleanup-01` | 실제 알림·영상 워커 및 esbuild 실행 중 | 1.739 |
| `20261030-mbti-intro-01` | 직전 정상 배포, 롤백 후보 | 1.785 |
| `20261030-word-liar-01` | current 및 현재 웹 실행 중 | 1.786 |

보존 릴리스 3개의 파일 구성·소스 manifest 해시·du 용량은 정리 전과 동일하다. `/var/lib/sliper/web-cache`를 가리키는 캐시 링크 3개도 유지되며, 삭제 시 심볼릭 링크의 대상은 따라가지 않았다.

## 재검사 및 실행 안전장치

1. 승인 전 조사와 실행 전 인벤토리 23개가 일치함을 확인했다. 후보의 소스 해시 변경·누락, 외부 하드링크, 데이터 의심 경로는 없었다.
2. 정확한 승인 경로 20개를 고정하고 current·보호 릴리스·실행 PID/cwd·파일 디스크립터·메모리 매핑·systemd/cron/프록시 참조를 재확인했다.
3. `/proc/self/mountinfo`로 정리 대상 아래의 별도/바인드 마운트가 없는지 검사했다. 후보가 releases 바로 아래의 실제 디렉터리이며 경로 이탈이 없음을 확인했다.
4. dry-run에서 파일 트리 메타데이터 지문과 root inode를 고정했다. 동일 후보 안의 하드링크는 모든 링크가 해당 후보 안에 있을 때만 허용했다. 릴리스 외부 캐시 링크는 명시된 경로 하나만 허용했다.
5. 실제 실행의 전체 사전 검사 후, 각 후보 직전에 참조·트리 지문을 재검사했다. fd 기반으로 심볼릭 링크 공격을 방어하는 Python rmtree를 사용해 승인 경로만 한 개씩 삭제했다. wildcard 삭제는 사용하지 않았다.
6. 실행 스크립트 자신의 CPU 우선순위를 낮추고 releases 디렉터리 fd에 advisory lock을 획득했다. 이 잠금은 기존 배포 도구가 자동으로 준수하는 공통 배포 잠금은 아니므로, 검사 시 실행 중인 배포/빌드/preview가 없는지도 확인했다.
7. runtime·incoming·ops·공용 캐시·업로드·DB·환경 설정·기존 사이트는 삭제 대상에 포함하지 않았다.

## 서비스 검증

| 구성 요소 | 결과 |
|---|---|
| `sliper-web.service` | active/running, PID `3651284` 유지 |
| `sliper-notifications.service` | active/running, PID `3452422` 유지 |
| `sliper-video.service` | active/running, PID `3452423` 유지 |
| `https://sliper.kr/ops/health` | HTTP 200 |
| `https://sliper.kr/api/health` | HTTP 200 |
| `http://127.0.0.1:3000/` | HTTP 200 |

current 링크와 웹·워커 시작 시각이 그대로 유지됐다. 기존 사이트는 동일한 PID 2568986과 `/root/Contenido_website` 실행 경로를 유지했다. 삭제한 릴리스 경로를 붙잡는 열린 삭제 파일은 없었다. 조사 명령의 작은 shell 임시 파일만 관측됐다.

상태 확인은 서비스 프로세스·소스 보존·health 응답을 기준으로 했다. 실제 계정의 로그인·결제·실기기 알림 등 전체 사용자 시나리오를 새로 실행한 것은 아니다.

## 실제 삭제 경로 — 승인 목록과 일치

- `/opt/sliper/releases/20261026-direct-01`
- `/opt/sliper/releases/20261029-address-picker-01`
- `/opt/sliper/releases/20261029-address-picker-02`
- `/opt/sliper/releases/20261029-adsense-head-02`
- `/opt/sliper/releases/20261029-footer-category-01`
- `/opt/sliper/releases/20261029-footer-links-01.building`
- `/opt/sliper/releases/20261029-home-shortcuts-01`
- `/opt/sliper/releases/20261029-launch-preparation-01.building`
- `/opt/sliper/releases/20261029-launch-preparation-02.building`
- `/opt/sliper/releases/20261029-launch-preparation-03`
- `/opt/sliper/releases/20261029-launch-preparation-04`
- `/opt/sliper/releases/20261029-navigation-hubs-02.building`
- `/opt/sliper/releases/20261029-navigation-hubs-03`
- `/opt/sliper/releases/20261030-desktop-home-01`
- `/opt/sliper/releases/20261030-game-lobby-01`
- `/opt/sliper/releases/20261030-game-qr-01`
- `/opt/sliper/releases/20261030-mbti-game-01`
- `/opt/sliper/releases/20261030-nav-preparing-01`
- `/opt/sliper/releases/20261030-story-controls-02`
- `/opt/sliper/releases/20261030-story-controls-03`

## 남은 재발 방지 작업

이번 작업은 승인된 20개 정리로 한정했다. 자동 삭제 타이머나 배포 스크립트는 변경하지 않았다.

- 배포 성공 후 current + 실제 웹·워커 참조 + 직전 정상 롤백 릴리스의 합집합을 보호하는 보존 정책 반영.
- 실패 빌드 보존 기간 및 공통 배포/정리 잠금 도입, dry-run 목록·예상 용량과 감사 로그 제공.
- 빌드 전후 가용 공간 검사 및 80%/90% 경보 연결.
- 워커 배포 패키지에서 전체 웹 빌드·개발 의존성·컴파일 캐시를 분리해 릴리스당 용량 축소.

알림·영상 워커는 여전히 `20261028-map-cleanup-01`을 사용한다. 자동 정리 구현 시 날짜가 오래됐다는 이유로 이 디렉터리를 삭제하면 안 된다.

## 근거 파일

- 사전 제안: `docs/DISK_RELEASE_AUDIT_2026-10-31.md`
- 실행 전: `.local/disk-cleanup-precheck-{runtime,config,inventory}-20261031.json`
- dry-run: `.local/disk-cleanup-dryrun-20261031.jsonl`
- 순차 삭제 및 최종 결과: `.local/disk-cleanup-execution-20261031.jsonl`
- 실행 후: `.local/disk-cleanup-postcheck-{runtime,config,inventory,du}-20261031.json`
