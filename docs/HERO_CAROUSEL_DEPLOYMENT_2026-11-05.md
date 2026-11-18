# 모집 배너 업데이트 운영 배포 — 2026-11-05

완료. 사용자 요청 “업데이트된거 배포해줘”에 따라 https://sliper.kr 에 `20261105-hero-carousel-02`를 반영했다.

원격 main `7cabc16c7c5ad93adad7a4c68016fa33ff7099c0` (PR #2, hero-carousel) 기준이다. 배포 직전 fetch로 최신 main 일치를 재확인했다. 로컬 브랜치 design/hero-carousel의 `f431352edb144a728b1ca2100c9d5c5d5250563f`는 해당 main과 Git tree가 동일했고 사용자 브랜치는 변경하지 않았다.

기존 사진 콜라주가 최대 5개 모집을 표시하는 자동 전환 배너로 바뀌었다. 모집이 없으면 안내 배너를 제공하며 일시정지·진행 표시·PC 이전/다음·모바일 스와이프를 지원한다.

모바일 실제 터치 입력에서 기본 touch-action으로 pointercancel이 발생해 스와이프가 취소됨을 재현했다. `touch-action: pan-y`로 세로 스크롤을 보존하며 가로 제스처를 처리하도록 보완했다. 새 pointerdown과 pointercancel에서 이전 제스처 상태를 정리해 이후 첫 탭도 정상 동작한다.

이 보완은 src/app/site-refresh.css와 src/components/hero-carousel.tsx의 로컬 미커밋 변경으로 포함했다. 새 Git 커밋·푸시는 수행하지 않았다. 패키지 SHA-256: `26a22070291e62e46dde962def30bd623b3d55ebef3615e60f942acf404b3eb7`. 694개 소스를 지문 검증하고 변경 목록을 대조했다.

## 검증

- TypeScript·비밀값 검사·관련 테스트 19개·diff 검사 통과.
- Linux 운영 빌드와 서버 trace 134개 검사 통과, 오류 0개.
- standalone 5,270개 파일에서 금지 파일·예상 밖 symlink 없음.
- 검증 서버와 공개 주소에서 각각 주요 화면·모바일 메뉴·검색 등 13개 시나리오 통과.
- 검증 서버와 공개 주소에서 각각 배너 3개 시나리오 통과: 자동 넘김·일시정지·PC 화살표·진행 표시 선택·모바일 Chrome CDP 터치 스와이프·이후 첫 탭·연결 화면·가로 넘침 없음.
- 공개 브라우저 검증 16개, 런타임 오류 0건. 기존 흰색 호스트 카드·시그니처 버튼도 확인했다.
- 320·393·720px 모바일 viewport와 1440px PC를 사용했다. 실제 Android/iPhone 기기를 원격 조작한 검사는 아니다. 전체 백엔드 검사를 새로 반복하지 않았으며 변경 범위에 맞는 검증을 수행했다.

## 운영 상태

웹 서비스만 새 릴리스로 전환했다. 타운·알림·영상·Redis·모니터·Nginx의 PID와 시작 시각을 보존했고 기존 Contenido 사이트도 HTTP 200이다. DB·환경 설정·프록시 변경은 없다.

직전 정상 릴리스 20261105-host-card-01를 보존했다. 임시 검증 서버·unit·SSH 터널을 정리했고 기존 릴리스 삭제는 하지 않았다.

```text
Filesystem       1B-blocks        Used   Available Use% Mounted on
/dev/xvda1     52573995008 22383546368 27489423360  45% /
```

감사 근거는 .local/hero-carousel-plan-20261105.json, hero-carousel-stage-20261105.log, hero-carousel-finalize-20261105.log, hero-carousel-deploy-20261105.log, hero-carousel-preview-layout-20261105/report.json, hero-carousel-preview-qa-20261105/report.json, hero-carousel-public-layout-20261105/report.json, hero-carousel-public-qa-20261105/report.json, hero-carousel-complete-20261105.json에 보관했다. 운영 상태 파일은 /opt/sliper/ops/hero-carousel-status-20261105.json이다.
