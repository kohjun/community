# Pretendard와 사진·영상 압축

2026-10-06 구현 기준. Worker·Redis 운영 흐름은 [사진 준비·영상 Worker·공지방 실시간 갱신](MEDIA_WORKERS_AND_ROOM_REALTIME.md)에 정리했다.

사이트 본문·폼·리치 에디터는 공식 Pretendard v1.3.9 가변 WOFF2를 next/font/local로 자체 제공한다. 글꼴은 방문자 기기에 설치되어 있지 않아도 적용하며 외부 폰트 CDN에 연결하지 않는다. public/fonts/README.md에 출처·해시·OFL 라이선스를 기록했다. 링크 공유 미리보기는 기존 이미지 렌더러용 Noto 폰트를 사용한다.

## 저장 기준

| 구분        | 원본 업로드                             | 압축 결과                                     |
| ----------- | --------------------------------------- | --------------------------------------------- |
| 본문 사진   | 10MiB / 2천만 화소 이하, 최대 10장      | 최대 2400px WebP, 2MiB 이하                   |
| 프로필 사진 | 5MiB / 2천만 화소 이하                  | 최대 512×512 WebP, 256KiB 이하                |
| 본문 영상   | 50MiB / 3분 / 2천만 화소 이하, 최대 3개 | 최대 1280×720 안의 MP4(H.264/AAC), 25MiB 이하 |

사진은 브라우저 Canvas로 업로드 전에 품질·크기를 단계적으로 줄인다. 가능한 경우 헤더에서 2천만 화소 제한을 디코딩 전에 확인하고 사진을 하나씩 처리한다. 준비 결과가 원본보다 작을 때만 사용하며 API 미지원·실패·이득 없는 경우에는 입력 한도 안의 원본을 전송한다. 서버 Sharp는 실제 바이트·형식·치수를 다시 검증하고 WebP 재인코딩으로 EXIF/GPS를 제거한다. GIF·움직이는 WebP는 첫 장면만 저장한다. 자세한 사진 기준은 [IMAGE_COMPRESSION.md](IMAGE_COMPRESSION.md)를 참고한다.

영상 버튼에서 '기기에서 영상 선택'으로 MP4·MOV·WebM·Matroska를 올릴 수 있다. 서버는 비공개 원본과 PostgreSQL 작업을 저장하고 작업 ID를 반환한다. 별도 Node Worker가 FFprobe 검사·FFmpeg 변환을 수행하며, 에디터가 본인 작업 상태를 조회해 ready 압축 자산을 선택했던 커서 위치에 첨부한다. 앞뒤 텍스트·사진·외부 영상 링크와 기존 본문은 유지한다. YouTube·Vimeo 링크는 외부 플랫폼을 사용하며 파일을 가져오거나 압축하지 않는다.

영상은 종횡비와 회전을 반영해 가로·세로 경계 안으로 조절하고 30fps, CRF28, 최대 비디오900kbps, AAC96kbps로 변환한다. 아주 낮은 비트레이트 원본은 결과가 더 커질 수 있으므로 일정한 압축률을 보장하지 않는다. 결과가 저장 한도를 넘으면 거부한다. 원본은 비공개 처리용 저장소에 일시 보관하며, 성공/실패/만료 후 Worker가 정리한다. FFmpeg 프로세스의 임시파일도 정리한다.

## DB와 저장소

영상 결과는 sliper.video_assets(RLS)에 UUID·소유자·글·저장방식·용량·크기·길이·순서를 저장한다. 마이그레이션0037은 소유권·메타데이터 불변성과 외부 직접 접근 차단을 적용한다. 0039는 video_processing_jobs와 video_processing_outputs를 추가해 처리 상태·임대·원본 만료·시도별 결과 정리를 영구 기록한다. 0039 도입 당시에는 총62개 Sliper 테이블이었다. 2026-10-15 현재는 0064까지의 전체 마이그레이션과 79개 Sliper 테이블을 기준으로 한다. 본문에는 uploadedVideo/assetId만 기록하며 파일 경로·원본 파일명은 저장하지 않는다.

- 로컬 원본: .local/video-sources/UUID.bin; 결과: .local/videos/UUID.mp4.
- Supabase 비공개 버킷 원본: video-sources/UUID.bin; 결과: videos/UUID.mp4.
- MEDIA_STORAGE_BACKEND·SUPABASE_STORAGE_* 설정과 행별 저장 방식을 사진/프로필/영상이 함께 사용한다.
- 접수 POST /api/videos, 본인 상태 GET /api/videos/jobs/UUID, 결과 재생 GET/HEAD /api/videos/UUID.
- 원본에는 HTTP 읽기 경로·공개/서명 URL을 제공하지 않는다.
- 미첨부 결과는 본인만 열 수 있다. 게시된 글의 결과는 공개되며 삭제·숨김 글은 차단한다.
- Range 요청은206, 유효하지 않은 범위는416으로 응답한다.
- 글에서 영상 제거 시 미첨부로 돌아가며 마지막 첨부 해제 후30일 보관한다. F2의 정리 원장과 명시적 CLI 실행을 사용하고 자동 스케줄은 아직 없다. 행사 기록/출처 파일 등 제외 조건은 [F2 안내](COMMUNITY_APPEALS_RETENTION_AND_RESTORE.md)를 따른다.

## 실행 환경과 처리 한도

영상 Worker에 ffmpeg-static5.3.0과 @ffprobe-installer/ffprobe2.1.2를 설치한다. 배포 OS에서 npm ci를 실행하고 Windows node_modules를 Linux 서버에 복사하지 않는다. Web 요청 경로는 FFmpeg를 불러오거나 변환을 실행하지 않는다. Worker 실행 파일은 scripts/video-worker.ts이고 별도 이미지는 Dockerfile.video-worker로 빌드한다. compose.yaml은 로컬 Redis만 실행한다.

프로세스당 영상 하나를 처리하고 CPU 스레드를 제한한다. 여러 Worker는 PostgreSQL 행 잠금·SKIP LOCKED로 작업을 나누고 300초 임대와 시도별 토큰으로 오래된 Worker의 완료를 막는다. 시간당6회 업로드·사용자당3개 대기/처리 제한을 DB에서 적용한다. 일시 오류는 최대3회 재시도하고, 15분 업로드 예약·24시간 원본 만료와 시도별 결과 원장으로 중단된 파일 정리를 재실행한다. 원본은 완료/최종 실패 후 정리하며 공개된 결과는 임시 정리 대상에서 제외한다.

FFprobe/FFmpeg는 셸 없이 별도 프로세스로 실행하고 컨테이너·프로토콜·CPU·시간·출력 크기를 제한한다. 입력 검사15초·변환120초·변환 자체181초/25MiB 상한 후 결과3분 이하를 다시 검사한다. 작업 전체는240초로 제한한다. 네트워크 공유나 URL을 FFmpeg 입력으로 받지 않는다.

```powershell
npm run db:migrate
npm run video:worker
# 별도 터미널에서 Web 서버 실행
npm run dev
```

`npm run video:drain`은 정리와 처리 가능한 한 작업을 수행하고 종료한다. Web과 Worker는 같은 DB·비공개 저장소를 사용해야 한다. local 방식이면 원본/결과 디렉터리를 지속 디스크로 공유한다. Supabase 버킷은 application/octet-stream 원본50MiB와 video/mp4 결과25MiB를 허용해야 한다. 요청 안의 변환은 제거했지만 Web 서버·프록시가 원본50MiB를 받아야 하는 본문 제한은 여전히 필요하다. 스토리지 직접 업로드와 실제 부하 검증은 후속 과제다.

## 검증

```powershell
npm run check
npm run test:video-api
npm run test:rich-post-api
npm run build
```

사진 준비·영상 Worker·Redis 도입 당시 npm run check의 형식·타입·회귀/DB593개·Drizzle 검사가 통과했다. 아래 수치와 audit는 당시 검증 기록이며 최신 실행 결과는 [전체 현황](PROJECT_STATUS_AND_ROADMAP.md)을 따른다. 실제 FFmpeg와 비동기 Worker를 사용하는 영상 HTTP1개가 원본 제거·비공개 접근·Range 재생을 확인했다. npm audit는 취약점0개이며 운영 빌드가 통과했다. 로컬 Redis 컨테이너를 실행했고 healthy·PING/PONG 및 실제 Pub/Sub 프로세스 간 통합 검사 1개가 통과했다. 공지 작성 HTTP→DB 커밋→Redis→SSE 갱신과 참가 취소 후 접근 회수도 3초 이내로 확인했다. 실제 휴대폰 Canvas·영상 재생, 원격 Supabase·운영 부하는 별도 검증이 필요하다.

### 이전 검증 기록 (2026-10-05)

당시 동기 영상 구현에서 npm run check의 형식·타입·회귀519개·Drizzle 검사와 배포 빌드, FFmpeg 회귀11개·영상 HTTP1개·리치 글 HTTP1개가 통과했다. Pretendard 사전 로드·WOFF2 응답(200, 2,057,688바이트)과 배포 바이너리/개인 데이터 제외를 확인했다. 이 기록은 새 대기열·Worker 컨테이너·브라우저 Canvas 경로의 통과 결과가 아니다.

공식 자료: [Pretendard 릴리스](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9), [FFmpeg 문서](https://ffmpeg.org/ffmpeg.html), [FFmpeg 바이너리 패키지](https://github.com/eugeneware/ffmpeg-static), [FFprobe 패키지](https://github.com/SavageCore/node-ffprobe-installer), [Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob).
