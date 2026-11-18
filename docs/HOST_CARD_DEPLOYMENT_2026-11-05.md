# 호스트 카드 색상 운영 반영 — 2026-11-05

완료. 사용자 요청 “배포해”에 따라 `20261105-host-card-01`를 https://sliper.kr 에 반영했다.

변경은 `src/app/site-refresh.css`의 호스트 카드 색상 한 파일이다. 흰색 배경, 검정 계열 글씨, #0A84FE 버튼과 흰색 버튼 글씨, 버튼 hover 및 가이드 링크 색상을 적용했다. 주변 카드와 구분하는 얇은 테두리를 추가했다.

기반 커밋 `a7f1bba88a53e1610d7e2f52fd7b633532c0b141`에 현재 작업 폴더의 카드 CSS 변경을 포함했다. 새 Git 커밋·푸시는 수행하지 않았다. 소스 패키지 SHA-256: `8e7f358f3ac541cb82531a377d521e9aba70f0df3e351ac60d219db381dc565a`. CSS SHA-256: `17285306f686e343366323232180eef9cf971add81bfd9eac730adb2679170e9`.

Linux 운영 빌드·타입 검사·서버 trace 134개 검사에 통과했다. 별도 검증 서버와 실제 공개 주소에서 카드·글씨·버튼의 계산된 색상을 확인했고 hover·가이드 이동, 320px 모바일 메뉴·가로 넘침 검사도 통과했다. 브라우저 런타임 오류는 0건이다. CSS 변경에 맞춘 검사이며 전체 기능 테스트를 새로 반복하지 않았다.

웹 서비스만 새 버전으로 전환했다. 타운·알림·영상·Redis·모니터·Nginx와 별도 기존 사이트는 정상 상태를 유지했다. 직전 릴리스 `20261105-mobile-refresh-03`를 롤백용으로 보존했다. DB·환경 설정·프록시 변경은 없다.

임시 검증 서버·unit·SSH 터널을 정리했다. 최종 디스크 상태:

```text
Filesystem       1B-blocks        Used   Available Use% Mounted on
/dev/xvda1     52573995008 20911108096 28961861632  42% /
```

기존 탭에서 이전 화면이 보이면 새로고침해 새 CSS를 받으면 된다.

검증 근거는 `.local/host-card-plan-20261105.json`, `host-card-preview-qa-20261105/report.json`, `host-card-public-qa-20261105/report.json`, `host-card-deploy-20261105.log`, `host-card-complete-20261105.json`에 보관했다.
