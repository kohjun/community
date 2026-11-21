# 관측성·에러 추적·행동 분석 구성 (1~2단계)

Sliper는 서버 리소스·운영 비용·개인정보 부담을 최소화하는 방향으로 1·2단계 관측성을 구성했습니다.

## 구성 요약

| 단계  | 도구                              | 역할                                                     | 부담 최소화 기본값                                                                                           |
| ----- | --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1단계 | **Pino** (`src/server/logger.ts`) | 웹·알림 워커·영상 워커 구조화 JSON 로그                  | 이메일·연락처·쿠키·토큰·DB URL 자동 `[Redacted]`                                                             |
| 1단계 | **Sentry** (`@sentry/nextjs`)     | 서버·워커·브라우저(3D 웹게임 포함) 오류 및 10% 성능 추적 | `dataCollection`으로 쿠키·헤더·본문·DB 파라미터 수집 해제, URL 쿼리/UUID/개인정보 제거, 세션 리플레이 비포함 |
| 2단계 | **PostHog** (`posthog-js`)        | 화면 이동 및 핵심 전환 퍼널 분석                         | **세션 리플레이 OFF**, 오토캡처 OFF, 쿠키 미사용(`localStorage`), 운영자·제외 계정 자동 옵트아웃             |

## 운영 활성화 방법

키가 비어 있거나 로컬 개발(`LOCAL_DATABASE=1`, `NODE_ENV=development`)일 때는 외부 전송이 완전히 꺼집니다(No-op).

운영 `.env.production`에 아래 값만 채우고 컨테이너를 재시작하면 별도 코드 수정 없이 활성화됩니다.

```env
# 1단계: 구조화 로그 + Sentry
LOG_LEVEL=info
SENTRY_DSN=https://<public_key>@<org>.ingest.us.sentry.io/<project_id>
NEXT_PUBLIC_SENTRY_DSN=https://<public_key>@<org>.ingest.us.sentry.io/<project_id>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# 2단계: PostHog (미국 리전: https://us.i.posthog.com / 유럽 리전: https://eu.i.posthog.com)
SLIPER_POSTHOG_KEY=phc_<project_api_key>
SLIPER_POSTHOG_HOST=https://us.i.posthog.com
```

> 소스맵까지 Sentry에 업로드하려면 빌드 시점 환경변수로 `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`을 추가하세요.

## 자동 수집 이벤트 (PostHog)

개인정보·검색어 원문·게시글 본문·방 UUID는 수집하지 않고, 경로 패턴(`/games/:id`, `/posts/:id`)과 익명 퍼널 이벤트만 수집합니다.

- `$pageview` (쿼리·UUID 제거된 경로 패턴)
- `home_banner_click` / `home_quick_link_click` / `audience_mode_switch`
- `event_apply_submitted`
- `web_game_selected` / `web_game_room_created` / `web_game_room_joined` / `web_game_started`
- `snap_pang_round_completed`
- `post_published`

활성화 시 `/policies/privacy`의 외부 서비스 제공업체 목록에도 Sentry·PostHog 안내가 자동으로 함께 표시됩니다.
