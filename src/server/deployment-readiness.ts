import {
  isAdSenseClientId,
  isAdSenseSlotId,
  readAdvertisingConfiguration,
} from "../domain/advertising";
import { authConfiguration } from "./auth-config";
import { imageStorageConfiguration } from "./image-storage-config";
import { parsePushConfiguration } from "./push-configuration";
import { parseRedisConfiguration, isPrivateRedisHost } from "./redis-configuration";

type Environment = Record<string, string | undefined>;
export interface DeploymentCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}
const present = (value: string | undefined) => !!value?.trim();
function https(value: string | undefined, originOnly = false) {
  try {
    const url = new URL(value ?? "");
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      host !== "localhost" &&
      host !== "[::1]" &&
      !host.endsWith(".local") &&
      !/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) &&
      (!originOnly || (url.pathname === "/" && !url.search && !url.hash))
    );
  } catch {
    return false;
  }
}
function database(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    decodeURIComponent(url.username);
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      !!url.username &&
      !!url.password &&
      url.pathname.length > 1 &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      ["require", "verify-full", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "")
      ? url
      : null;
  } catch {
    return null;
  }
}

function advertisingReadiness(env: Environment): DeploymentCheck {
  const flag = env.SLIPER_ADSENSE_ENABLED;
  const clientId = env.SLIPER_ADSENSE_CLIENT_ID ?? "";
  const inline = env.SLIPER_ADSENSE_SLOT_INLINE ?? "";
  const left = env.SLIPER_ADSENSE_SLOT_LEFT ?? "";
  const right = env.SLIPER_ADSENSE_SLOT_RIGHT ?? "";
  const invalid = (): DeploymentCheck => ({
    id: "advertising",
    status: "fail",
    message:
      "AdSense 설정이 불완전합니다. 활성화 값은 true 또는 false이며, 게시자 ID·광고 단위 ID·공개 HTTPS 도메인을 확인하세요. 운영 광고는 로컬 DB 모드에서 켤 수 없습니다.",
  });
  if (flag !== undefined && flag !== "" && flag !== "true" && flag !== "false") return invalid();
  const hasIdentifiers = [clientId, inline, left, right].some((value) => value !== "");
  if (!hasIdentifiers && flag !== "true")
    return {
      id: "advertising",
      status: "warn",
      message:
        "AdSense가 미설정이며 실제 광고 요청은 비활성화되어 있습니다. 게시자·광고 단위 ID 발급 후 연결하세요.",
    };
  if (
    !isAdSenseClientId(clientId) ||
    [inline, left, right].some((value) => value !== "" && !isAdSenseSlotId(value))
  )
    return invalid();
  // Inspect the prospective production configuration without changing the running environment.
  const configuration = readAdvertisingConfiguration({ ...env, NODE_ENV: "production" });
  if (!configuration.clientId || !configuration.siteOrigin) return invalid();
  if (flag === "true")
    return configuration.enabled
      ? {
          id: "advertising",
          status: "pass",
          message:
            "AdSense 설정 형식이 유효합니다. 실제 광고 요청·사이트 승인·게재 상태는 확인하지 않았습니다.",
        }
      : invalid();
  return {
    id: "advertising",
    status: "warn",
    message:
      "AdSense 사이트 확인용 설정 형식이 유효하며 실제 광고는 비활성화되어 있습니다. 사이트 승인 후 광고 단위 ID와 활성화 설정을 적용하세요.",
  };
}

/** Static, redacted configuration inspection. Never connects, reads credentials files, or provisions resources. */
export function deploymentReadiness(env: Environment): DeploymentCheck[] {
  const rows: DeploymentCheck[] = [];
  const check = (id: string, ok: boolean, good: string, bad: string) =>
    rows.push({ id, status: ok ? "pass" : "fail", message: ok ? good : bad });
  const optional = (
    id: string,
    keys: string[],
    ok: boolean,
    good: string,
    absent: string,
    bad: string,
  ) => {
    const configured = keys.some((key) => present(env[key]));
    rows.push({
      id,
      status: !configured ? "warn" : ok ? "pass" : "fail",
      message: !configured ? absent : ok ? good : bad,
    });
  };
  check(
    "development-access",
    env.LOCAL_DATABASE === "0" &&
      env.SLIPER_AUTH_MODE === "supabase" &&
      !present(env.SLIPER_LAN_HOST),
    "운영 인증 모드이며 로컬 테스트 접근이 꺼져 있습니다.",
    "LOCAL_DATABASE=0, SLIPER_AUTH_MODE=supabase로 설정하고 SLIPER_LAN_HOST를 비우세요.",
  );
  check(
    "site-origin",
    https(env.APP_ORIGIN, true),
    "서비스 원본 주소 형식이 유효합니다.",
    "APP_ORIGIN에 경로·쿼리·인증 정보가 없는 공개 HTTPS 원본 주소를 설정하세요.",
  );
  check(
    "authentication",
    !!authConfiguration(env) && https(env.NEXT_PUBLIC_SUPABASE_URL, true),
    "Supabase 인증 설정 형식이 유효합니다. 공급자 왕복 로그인 검증이 별도로 필요합니다.",
    "Supabase 프로젝트 URL과 publishable key를 설정하고 카카오·구글 공급자를 준비하세요.",
  );
  const db = database(env.DATABASE_URL);
  check(
    "database",
    !!db,
    "DB 연결 형식과 SSL 설정이 유효합니다.",
    "DATABASE_URL에 로컬이 아닌 PostgreSQL 연결 및 sslmode=require 이상을 설정하세요.",
  );
  if (db) {
    const migration = database(env.MIGRATION_DATABASE_URL);
    const role = decodeURIComponent(db.username).split(".")[0] ?? "";
    rows.push({
      id: "database-role",
      status:
        ["postgres", "supabase_admin"].includes(role) ||
        (migration && decodeURIComponent(migration.username).split(".")[0] === role)
          ? "fail"
          : "warn",
      message:
        "실행용 DB 역할을 마이그레이션 소유자와 분리하세요. RLS 접근·테이블/함수 권한은 DB에서 확인해야 합니다.",
    });
  }
  const migration = database(env.MIGRATION_DATABASE_URL);
  rows.push({
    id: "migrations",
    status: migration && migration.port !== "6543" ? "pass" : "warn",
    message:
      migration && migration.port !== "6543"
        ? "마이그레이션용 연결 형식이 유효합니다. 전체 적용 결과와 복원 검증이 별도로 필요합니다."
        : "마이그레이션에는 소유자 direct/session 연결을 별도 준비하세요. 운영 앱에 소유자 비밀번호를 배포하지 마세요.",
  });
  check(
    "visitor-signature",
    (env.VISITOR_HASH_SECRET?.length ?? 0) >= 32,
    "조회수 방문자 서명 키가 설정되어 있습니다.",
    "VISITOR_HASH_SECRET에 모든 서버가 공유하는 최소 32자 난수를 설정하세요.",
  );
  const roomRedis = parseRedisConfiguration(env.REDIS_URL);
  if (!present(env.REDIS_URL)) {
    rows.push({
      id: "room-realtime",
      status: "warn",
      message: "REDIS_URL이 없습니다. 공지방 메시지는 DB에 저장되며 5초 조회 방식으로 갱신됩니다.",
    });
  } else if (!roomRedis) {
    rows.push({
      id: "room-realtime",
      status: "fail",
      message: "REDIS_URL에 유효한 호스트가 있는 redis:// 또는 rediss:// 주소를 설정하세요.",
    });
  } else if (roomRedis.protocol === "rediss:") {
    rows.push({
      id: "room-realtime",
      status: "pass",
      message:
        "공지방 Redis 주소 형식과 TLS 설정이 유효합니다. 실제 연결과 여러 서버 간 수신을 별도 검증하세요.",
    });
  } else {
    const privateHost = isPrivateRedisHost(roomRedis.hostname);
    rows.push({
      id: "room-realtime",
      status: privateHost || env.NODE_ENV === "development" ? "warn" : "fail",
      message: privateHost
        ? "로컬·내부 호스트 형식의 Redis 평문 주소입니다. 운영에서는 사설망 접근 통제 또는 rediss:// TLS를 확인하세요."
        : "공개 Redis 평문 주소입니다. 운영에서는 사설망 Redis 주소 또는 rediss:// TLS를 사용하세요.",
    });
  }

  const exposed = Object.entries(env).some(([key, value]) => {
    if (!present(value) || !key.startsWith("NEXT_PUBLIC_")) return false;
    const normalized = value!.trim();
    return (
      /SECRET|PASSWORD|SERVICE_ROLE|DATABASE_URL|REDIS|PRIVATE_KEY|VAPID_PRIVATE|PAYMENT_API_KEY/i.test(
        key,
      ) ||
      normalized.startsWith("sb_secret_") ||
      /^(?:rediss?|postgres(?:ql)?):\/\//i.test(normalized) ||
      /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/.test(normalized) ||
      /^[a-z][a-z\d+.-]*:\/\/[^/\s]*:[^/\s]*@/i.test(normalized)
    );
  });
  check(
    "public-secrets",
    !exposed,
    "알려진 비밀키용 공개 환경변수가 발견되지 않았습니다.",
    "NEXT_PUBLIC_ 환경변수에서 서버 비밀키·DB/Redis 주소·비밀번호를 제거하고 노출된 키는 교체하세요.",
  );
  const storage = env.MEDIA_STORAGE_BACKEND ?? "local";
  if (storage === "supabase") {
    let storageValid = false;
    try {
      storageValid = imageStorageConfiguration("supabase", env).backend === "supabase";
    } catch {
      /* Redacted invalid settings. */
    }
    check(
      "image-storage",
      storageValid,
      "Supabase 이미지 저장소 설정 형식이 유효합니다. private 버킷 실제 검증이 필요합니다.",
      "SUPABASE_STORAGE_URL·서버 전용 SECRET_KEY·비공개 BUCKET을 설정하세요.",
    );
  } else if (storage === "local") {
    rows.push({
      id: "image-storage",
      status: "warn",
      message:
        "로컬 이미지 저장 중입니다. 배포 전 private 저장소를 연결하거나 영구 공유 디스크·복구 정책을 준비하세요.",
    });
  } else
    rows.push({
      id: "image-storage",
      status: "fail",
      message: "MEDIA_STORAGE_BACKEND는 local 또는 supabase여야 합니다.",
    });
  optional(
    "payment-bridge",
    [
      "PAYMENT_PROVIDER",
      "PAYMENT_CHECKOUT_API_URL",
      "PAYMENT_API_KEY",
      "PAYMENT_WEBHOOK_SECRET",
      "PAYMENT_CHECKOUT_ORIGINS",
    ],
    !!env.PAYMENT_PROVIDER &&
      /^[a-zA-Z0-9_-]{1,40}$/.test(env.PAYMENT_PROVIDER) &&
      env.PAYMENT_PROVIDER !== "local-test" &&
      https(env.PAYMENT_CHECKOUT_API_URL) &&
      present(env.PAYMENT_API_KEY) &&
      (env.PAYMENT_WEBHOOK_SECRET?.length ?? 0) >= 32 &&
      !!env.PAYMENT_CHECKOUT_ORIGINS &&
      env.PAYMENT_CHECKOUT_ORIGINS.split(",").every((origin) => https(origin.trim(), true)),
    "결제 브리지 설정 형식이 유효합니다. 실제 플랫폼 어댑터·서명·환불 대사를 검증하세요.",
    "결제는 미연동입니다. 실제 유료 신청을 열기 전에 플랫폼 브리지를 연결하세요.",
    "결제 브리지 설정이 일부 누락되었거나 주소·서명 키 형식이 유효하지 않습니다.",
  );
  optional(
    "external-approval",
    ["EXTERNAL_APPROVAL_PROVIDER", "EXTERNAL_APPROVAL_WEBHOOK_SECRET"],
    !!env.EXTERNAL_APPROVAL_PROVIDER &&
      /^[a-zA-Z0-9_-]{1,40}$/.test(env.EXTERNAL_APPROVAL_PROVIDER) &&
      !["manual", "local-test"].includes(env.EXTERNAL_APPROVAL_PROVIDER) &&
      (env.EXTERNAL_APPROVAL_WEBHOOK_SECRET?.length ?? 0) >= 32,
    "외부 승인 설정 형식이 유효합니다. 회원 연결 및 서명된 실제 웹훅을 검증하세요.",
    "외부 자동 승인은 미연동입니다. 담당자 수동 승인 기능을 사용할 수 있습니다.",
    "외부 승인 공급자와 최소 32자 웹훅 서명 키를 함께 설정하세요.",
  );
  optional(
    "library-payment",
    ["LIBRARY_PAYMENT_PROVIDER", "LIBRARY_PAYMENT_WEBHOOK_SECRET"],
    !!env.LIBRARY_PAYMENT_PROVIDER &&
      /^[a-zA-Z0-9_-]{1,40}$/.test(env.LIBRARY_PAYMENT_PROVIDER) &&
      !["manual", "local-test"].includes(env.LIBRARY_PAYMENT_PROVIDER) &&
      (env.LIBRARY_PAYMENT_WEBHOOK_SECRET?.length ?? 0) >= 32,
    "자료 결제 서명 설정 형식이 유효합니다. 구매 번호·회원·금액 연결과 실제 환불 알림을 검증하세요.",
    "자료 결제 자동 승인은 미연동입니다. 판매자 수동 구매 확인을 사용할 수 있습니다.",
    "자료 결제 공급자와 최소32자 전용 서명 키를 함께 설정하세요.",
  );
  optional(
    "web-push",
    ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    !!parsePushConfiguration({
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    }),
    "VAPID 키 쌍 형식이 유효합니다. HTTPS 휴대폰에서 수신을 검증하세요.",
    "기기 푸시 키가 없습니다. 사이트 알림은 DB에 저장되지만 휴대폰 전송은 준비되지 않았습니다.",
    "연락 URI와 서로 일치하는 VAPID 공개키·비밀키를 함께 설정하세요.",
  );
  check(
    "notification-worker",
    env.PUSH_WORKER_MODE === "external",
    "별도 Worker 모드입니다. push:worker를 상시 실행하고 대기열을 확인하세요.",
    "PUSH_WORKER_MODE=external로 설정하고 지속 실행하는 별도 알림 Worker를 준비하세요.",
  );
  rows.push(advertisingReadiness(env));
  rows.push({
    id: "operational-verification",
    status: "warn",
    message:
      "이 검사는 설정 형식만 확인합니다. DB/RLS·버킷 비공개·OAuth·거래·백업 복원·기기 수신·부하 검증은 완료를 뜻하지 않습니다.",
  });
  return rows;
}
