# 운영 의존성 취약점 감사

> **후속 조치:** Next.js·@next/env 16.4.3, Zod 4.6.7 반영 후 운영 npm 재감사에서 취약점 0건을 확인했다. 아래는 업데이트 전 감사 원본이다. [수정과 검증 결과](PRIORITY_FIXES_2026-10-25.md).

기준: 2026-10-25. 사용자가 패키지명·버전·의존성 트리를 외부 npm 레지스트리로 전송하는 검사를 명시적으로 허용한 뒤 수행했다.

실행: `npm audit --omit=dev --json --fetch-timeout=20000 --fetch-retries=0`. 운영 의존성을 대상으로 하며 개발 의존성 전체에 대한 무결함 판정이 아니다. 이번에는 패키지 설치/업데이트, lockfile 변경, 공격 재현, 서버 재시작을 실행하지 않았다.

## 결과: 조치 필요

npm 집계는 **영향 패키지 2개: Critical 1개, High 1개**다. 이는 패키지별 최고 심각도 집계이며 현재 사이트에서 두 공격을 재현했다는 뜻은 아니다. next에 연결된 권고 10개, zod 1개가 포함된다.

| 패키지 | 선언/설치/잠금 버전 | npm 심각도 | 감사가 제시한 업데이트 |
| --- | --- | --- | --- |
| next | 16.3.7 | Critical | 16.4.3 |
| zod | 4.6.5 | High | 4.6.7 |

`package.json`, `node_modules`와 `package-lock.json`에서 현재 버전이 일치함을 확인했다. 원본 JSON은 Git 제외 디렉터리 `.local/comprehensive-production-audit.json`에 보관했다.

## 현재 코드와 대조한 영향

### 1. 우선 조치: Next.js Server Actions 서비스 거부

[공식 Next.js 권고 GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)는 App Router에서 Server Action을 하나 이상 사용하는 앱이 조작된 요청으로 CPU를 과도하게 사용해 같은 프로세스의 요청 처리를 막을 수 있다고 설명한다. Next 16 계열 수정 최소 버전은 16.4.1이며 별도 우회책은 안내하지 않는다.

현재 앱은 App Router를 사용하고 [actions.ts:1](C:/Sliper/src/app/actions.ts:1)의 Server Actions 세 개를 실제 글 등록/수정/삭제 경로에서 사용한다. 현재 빌드의 서버 액션 원장에도 세 개가 있다. **영향 버전과 기능 조건은 확인했다.** 실제 서비스 거부 공격이나 서버 중단을 재현하지 않았다. 앱 내부 인증·요청 검사가 프레임워크의 요청 해석 단계 문제를 해결한다고 간주할 수 없다.

### 2. 우선 조치: Zod 컬렉션 검증 자원 소모

[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)와 [작성자의 수정 PR](https://github.com/colinhacks/zod/pull/6652)은 큰 컬렉션의 원소를 전부 검증한 뒤 길이 제한을 적용하면서 메모리와 오류 객체가 늘어나는 문제를 다룬다. 수정 최소 버전은 4.6.6이다.

현재 4.6.5를 사용하며 자료·이벤트 계획·질문·투표 등 중첩 배열을 검증한다. 특히 [library-service.ts:524](C:/Sliper/src/server/library-service.ts:524)와 559행은 소유자/회원 확인 전에 중첩 스키마를 파싱하므로 일부 비로그인 요청도 검증에 도달한다.

[http.ts:17](C:/Sliper/src/server/http.ts:17)의 실제 스트림 크기 제한(기본 150,000바이트)은 완화 장치다. 그러나 검증 중 오류/메모리 확대에 대한 안전성을 입증하지는 않는다. **영향 버전과 도달 가능한 검증 경로를 소스로 확인했으며, 메모리 고갈 공격은 수행하지 않았다.** 수정 버전 반영 후 인증과 저렴한 크기/형태 확인을 무거운 검증보다 앞에 두는 것도 보완한다.

### 3. Critical 권고의 적용 조건을 구분할 부분

- [SVG 이미지 최적화 RCE 권고](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)는 glibc Linux와 이미지 처리 라이브러리를 다루고 sharp 0.35.5 이상을 우회책으로 안내한다. 이 프로젝트는 **sharp 0.35.5가 선언·설치·잠금되어 있으며 Next 이미지 최적화 모듈도 그 복사본을 실제 해석한다.** 오래된 중첩 sharp 복사본은 발견하지 못했다. 해당 SVG RCE가 현재 그대로 적용된다고 판정하지 않는다.
- [use cache typed-array RCE 권고](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)는 Cache Components와 여러 typed array를 반환하는 use cache 함수가 조건이다. 현재 소스에는 해당 지시문이 없고 설정/현재 빌드의 cacheComponents는 false다. 새 사진 캐시는 자체 Map 기반 BoundedCache를 사용한다. 이 공격 경로는 관찰하지 못했으며, 권고는 관련 함수가 없더라도 업데이트를 권장한다.
- 나머지 캐시·개발 MCP·메타데이터·이미지 SSRF 권고는 감사 결과에 포함됐다. 모든 세부 조건과 실제 배포 노출을 재현한 것은 아니다. 특정 RCE의 조건이 없다고 next 전체의 업데이트 필요성을 지우지 않는다.

## 수정 우선순위

**P1: 공개 배포 전 보안 의존성 업데이트를 먼저 수행한다.** 다음은 계획이며 이번 감사에서 실행한 변경은 아니다.

1. next와 @next/env를 16.4.3으로 맞추고 zod를 4.6.7로 업데이트한다. @next/env는 이번 감사의 영향 패키지로 보고된 것은 아니며 Next 보조 패키지 버전을 맞추는 작업이다.
2. 잠금 파일에서 실제 해석 버전과 sharp 0.35.5 이상 유지 여부를 확인한다. 무조건적인 audit fix --force는 사용하지 않는다.
3. 설치한 새 Next 버전의 번들 문서를 확인한 뒤 타입·전체 회귀·운영 빌드·서버 추적 검사와 글 작성/로그인/업로드를 확인한다.
4. npm 운영 감사 재실행으로 위 권고가 제거됐는지 확인한 다음 기존 종합 리뷰의 R1 이후 항목을 진행한다.

종합 리뷰에서 애플리케이션 코드 P0/P1을 재현하지 못했다는 기록과 이번 의존성 감사의 P1 업데이트 권고는 구분한다. 기존 1,034개 테스트 성공은 알려진 프레임워크 취약점을 배제하는 증거가 아니다.
