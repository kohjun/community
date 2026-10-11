import { createHmac, timingSafeEqual } from "node:crypto";
// The bridge contract signs the exact bytes, never a re-serialized JSON object.
export function verifyPaymentSignature(
  body: Uint8Array,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (
    secret.length < 32 ||
    !timestamp ||
    !/^\d{10}$/.test(timestamp) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(nowSeconds - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(body)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
