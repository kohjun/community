import type { NetworkInterfaceInfo } from "node:os";

type Interfaces = Record<
  string,
  readonly Pick<NetworkInterfaceInfo, "address" | "family" | "internal">[] | undefined
>;
function privateIPv4(address: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split(".").map(Number);
  if (parts.some((part) => part > 255) || parts.join(".") !== address) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
  );
}
/** Choose one current physical LAN address. Never trust a wildcard or an obsolete DHCP address. */
export function developmentLanAddress(interfaces: Interfaces, configured?: string): string {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) =>
    /vethernet|virtual|wsl|docker|vmware|loopback|tailscale|zerotier|vpn/i.test(name)
      ? []
      : (entries ?? [])
          .filter(
            (entry) => entry.family === "IPv4" && !entry.internal && privateIPv4(entry.address),
          )
          .map((entry) => ({ name, address: entry.address })),
  );
  if (configured && candidates.some((entry) => entry.address === configured)) return configured;
  candidates.sort(
    (a, b) =>
      Number(!/wi-?fi|wireless|무선/i.test(a.name)) -
        Number(!/wi-?fi|wireless|무선/i.test(b.name)) ||
      a.name.localeCompare(b.name) ||
      a.address.localeCompare(b.address),
  );
  if (!candidates[0]) throw new Error("연결된 Wi-Fi 또는 이더넷의 사설 IPv4 주소를 찾지 못했어요.");
  return candidates[0].address;
}
export function assertLocalLanDevelopment(env: Record<string, string | undefined>) {
  let valid = false;
  try {
    const database = new URL(env.DATABASE_URL ?? "");
    valid =
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      database.hostname === "127.0.0.1" &&
      database.port === "55432" &&
      database.pathname === "/sliper_dev";
  } catch {
    /* Do not return connection values. */
  }
  if (
    env.NODE_ENV !== "development" ||
    env.LOCAL_DATABASE !== "1" ||
    env.SLIPER_AUTH_MODE !== "development" ||
    !valid
  )
    throw new Error(
      "와이파이 개발 서버는 격리된 로컬 개발 DB와 개발 인증 환경에서만 실행할 수 있어요.",
    );
}
