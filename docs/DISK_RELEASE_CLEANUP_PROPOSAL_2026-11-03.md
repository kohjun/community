# Ncloud 불필요 릴리스 정리 제안 — 2026-11-03

상태: **사용자 승인 후 13개 정리 완료**. 약 18GB 확보, df 73% → 36%. 서비스 재시작 0회. 상세 결과: [정리 완료 보고서](DISK_RELEASE_CLEANUP_2026-11-03.md).

아래 내용은 승인 전 조사·제안 기록이다.

## 용량과 원인

현재 df 기준 사용률 73%다. 이전 웹게임 배포본과 타운 중간 빌드에 중복된 node_modules·Next.js 산출물이 쌓였다.

아래 정확한 13개 디렉터리만 정리하면 **약 18.00GB (16.76GiB)** 확보, 사용률은 **약 36%**로 예상한다. Ncloud 화면과 df는 집계 방식에 차이가 있을 수 있다.

## 보존 대상

| /opt/sliper/releases/ 아래 경로 | 이유 |
| --- | --- |
| `20261102-sliper-town-05` | current·현재 웹과 타운 실행 중 |
| `20261028-map-cleanup-01` | 실제 알림·영상 워커와 esbuild 실행 중 |
| `20261101-room-settings-01` | 직전 정상 배포, 웹 롤백용 |

Redis 바이너리/설정, runtime, incoming, ops, 공용 웹 캐시, 업로드·DB·환경 설정·인증서와 기존 별도 사이트는 제외한다.

## 승인 대상 목록

모든 경로는 `/opt/sliper/releases/`의 직접 하위 디렉터리다. 와일드카드 삭제는 사용하지 않는다.

| 디렉터리 | 실제 점유량 GiB |
| --- | ---: |
| `20261030-mbti-intro-01` | 1.785 |
| `20261030-word-liar-01` | 1.786 |
| `20261031-auction-game-01` | 1.162 |
| `20261031-auction-game-02` | 1.162 |
| `20261031-game-catalog-01` | 1.166 |
| `20261031-game-catalog-02` | 1.166 |
| `20261031-game-tutorial-01` | 1.164 |
| `20261031-game-tutorial-mobile-01` | 1.165 |
| `20261101-toast-game-01.building` | 1.374 |
| `20261101-toast-game-02` | 1.168 |
| `20261102-sliper-town-01` | 1.323 |
| `20261102-sliper-town-02.building` | 1.170 |
| `20261102-sliper-town-04.building` | 1.170 |

`20261101-toast-game-01.building`을 가리키는 옛 실패 빌드의 transient unit은 PID 0, Restart=no, 예약 트리거 없음으로 확인했다. 실행 중인 서비스의 참조가 아니다. 승인 후 정리가 끝나면 이 실패 상태만 해제한다. 서비스 시작·중지·재시작은 하지 않는다.

## 실행 안전장치

- manifest 소스 변경·누락, 실제 데이터 의심 경로, 별도 마운트, 외부 하드링크가 없는지 조사했다.
- 승인된 경로·크기·파일 트리 지문을 고정하고 삭제 직전 다시 확인한다. 릴리스 추가·빌드·배포·서비스 PID·current·참조가 달라지면 중단한다.
- 캐시 symlink는 링크 자체만 제거하고 `/var/lib/sliper/web-cache`는 따라가지 않는다. Python의 fd 기반 symlink 방어 rmtree로 고정한 경로만 하나씩 정리한다.
- 삭제 후 PID·시작 시각·current와 웹·타운·기존 사이트 health를 비교하고 실제 확보 용량을 보고한다.
- 릴리스 디렉터리 advisory lock은 기존 배포 도구가 공유하는 잠금은 아니므로 매 단계 실행 참조와 빌드 유무를 재검사한다.

근거: `.local/disk-audit-{runtime,config,inventory,du}-20261103.json`, `.local/disk-cleanup-plan-20261103.json`, `.local/disk-cleanup-dryrun-20261103.jsonl`.

Dry-run 결과: 후보 13개, 예상 확보 17,996,664,832 bytes. 파일 트리 지문·PID·참조·크기 검증 통과, 삭제 0건. 웹·타운·기존 사이트 health 200.
