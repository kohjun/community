import "server-only";
import { z } from "zod";
import { AppError } from "./errors";
export function paymentConfiguration() {
  const provider = process.env.PAYMENT_PROVIDER,
    endpoint = process.env.PAYMENT_CHECKOUT_API_URL,
    key = process.env.PAYMENT_API_KEY,
    secret = process.env.PAYMENT_WEBHOOK_SECRET,
    allowed = process.env.PAYMENT_CHECKOUT_ORIGINS;
  if (!provider && !endpoint && !key && !secret && !allowed) return null;
  if (
    !provider ||
    !/^[a-zA-Z0-9_-]{1,40}$/.test(provider) ||
    provider === "local-test" ||
    !endpoint ||
    !key ||
    !secret ||
    secret.length < 32 ||
    !allowed
  )
    throw new AppError("CONFLICT", "결제 플랫폼 설정이 완료되지 않았어요.");
  let api: URL, origins: string[];
  try {
    api = new URL(endpoint);
    origins = allowed.split(",").map((s) => {
      const u = new URL(s.trim());
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.pathname !== "/" ||
        u.search ||
        u.hash
      )
        throw new Error();
      return u.origin;
    });
  } catch {
    throw new AppError("CONFLICT", "결제 플랫폼 주소 설정을 확인해주세요.");
  }
  if (api.protocol !== "https:" || api.username || api.password)
    throw new AppError("CONFLICT", "결제 API는 HTTPS 주소여야 해요.");
  return { provider, endpoint: api.href, key, secret, origins };
}
export function localPaymentTesting(actor: string | null) {
  if (
    actor !== "00000000-0000-4000-8000-000000000001" ||
    process.env.NODE_ENV !== "development" ||
    process.env.LOCAL_DATABASE !== "1" ||
    process.env.SLIPER_AUTH_MODE !== "development"
  )
    return false;
  try {
    const u = new URL(process.env.DATABASE_URL || "http://missing");
    return u.hostname === "127.0.0.1" && u.port === "55432" && u.pathname === "/sliper_dev";
  } catch {
    return false;
  }
}
export function paymentMode(localActor: boolean): "external" | "local-test" | "unavailable" {
  return paymentConfiguration() ? "external" : localActor ? "local-test" : "unavailable";
}
export function validCheckoutUrl(url: string, origins: string[]) {
  try {
    const value = new URL(url);
    return (
      url.length <= 2048 &&
      value.protocol === "https:" &&
      !value.username &&
      !value.password &&
      origins.includes(value.origin)
    );
  } catch {
    return false;
  }
}
export async function createCheckout(order: {
  id: string;
  provider: string;
  amountKRW: number;
  postId: string;
  title: string;
}) {
  const config = paymentConfiguration();
  if (!config || config.provider !== order.provider)
    throw new AppError("CONFLICT", "이 주문의 결제 플랫폼이 연결되지 않았어요.");
  const origin = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:3000").origin;
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
        "Idempotency-Key": order.id,
      },
      body: JSON.stringify({
        orderId: order.id,
        amountKRW: order.amountKRW,
        currency: "KRW",
        title: order.title,
        returnUrl: `${origin}/events/${order.postId}`,
      }),
    });
  } catch {
    throw new AppError(
      "CONFLICT",
      "결제 화면을 준비하지 못했어요. 신청 내역에서 다시 시도해주세요.",
    );
  }
  if (!response.ok) throw new AppError("CONFLICT", "결제 플랫폼에서 주문을 생성하지 못했어요.");
  const parsed = z
    .object({ checkoutUrl: z.string().max(2048) })
    .safeParse(await response.json().catch(() => null));
  if (!parsed.success || !validCheckoutUrl(parsed.data.checkoutUrl, config.origins))
    throw new AppError("CONFLICT", "결제 플랫폼의 응답 주소를 확인하지 못했어요.");
  return parsed.data.checkoutUrl;
}
