import { z } from "zod";

export function readSiteOperations(env: Record<string, string | undefined>) {
  const text = (key: string, fallback = "") => {
    const value = env[key]?.trim() || fallback;
    return value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value) ? value : fallback;
  };
  const email = z.email().safeParse(text("SLIPER_SUPPORT_EMAIL", "kohjun1234@gmail.com"));
  const business = {
    name: text("SLIPER_BUSINESS_NAME"),
    representative: text("SLIPER_BUSINESS_REPRESENTATIVE"),
    registrationNumber: text("SLIPER_BUSINESS_REGISTRATION_NUMBER"),
    address: text("SLIPER_BUSINESS_ADDRESS"),
    ecommerceRegistration: text("SLIPER_ECOMMERCE_REGISTRATION"),
  };
  return {
    operatorName: text("SLIPER_OPERATOR_NAME", "Team sliper"),
    supportEmail: email.success ? email.data : "kohjun1234@gmail.com",
    business,
    businessComplete: Object.values(business).every(Boolean),
    privacyReviewed: env.SLIPER_PRIVACY_POLICY_REVIEWED === "true",
  };
}

export function supportMailto(email: string, subject = "Sliper 이용 문의") {
  if (!z.email().safeParse(email).success || /[\r\n]/.test(email)) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
