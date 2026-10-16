import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalLanDevelopment, developmentLanAddress } from "../scripts/lib/development-lan";
const item = (address: string, family: "IPv4" | "IPv6" = "IPv4", internal = false) => ({
  address,
  family,
  internal,
});
test("LAN startup selects an actual physical private address and refreshes obsolete DHCP configuration", () => {
  const interfaces = {
    "vEthernet (WSL)": [item("172.24.176.1")],
    Ethernet: [item("10.0.0.5")],
    "Wi-Fi": [item("192.168.123.103"), item("fe80::1", "IPv6")],
    Loopback: [item("127.0.0.1", "IPv4", true)],
  };
  assert.equal(developmentLanAddress(interfaces), "192.168.123.103");
  assert.equal(developmentLanAddress(interfaces, "192.168.123.102"), "192.168.123.103");
  assert.equal(developmentLanAddress(interfaces, "10.0.0.5"), "10.0.0.5");
  assert.equal(developmentLanAddress(interfaces, "*"), "192.168.123.103");
});
test("LAN startup never opens public, loopback, malformed or virtual-only addresses", () => {
  for (const address of ["8.8.8.8", "127.0.0.1", "169.254.1.2", "192.168.123.256", "192.168.001.2"])
    assert.throws(() => developmentLanAddress({ Ethernet: [item(address)] }));
  assert.throws(() => developmentLanAddress({ "vEthernet (WSL)": [item("172.24.176.1")] }));
  assert.throws(() => developmentLanAddress({}));
});
test("LAN test access cannot enable with a production flag or a different database", () => {
  const env = {
    NODE_ENV: "development",
    LOCAL_DATABASE: "1",
    SLIPER_AUTH_MODE: "development",
    DATABASE_URL: "postgres://fixture@127.0.0.1:55432/sliper_dev",
  };
  assert.doesNotThrow(() => assertLocalLanDevelopment(env));
  for (const changes of [
    { NODE_ENV: "production" },
    { LOCAL_DATABASE: "0" },
    { SLIPER_AUTH_MODE: "supabase" },
    { DATABASE_URL: "postgres://fixture@cloud.example/sliper_dev" },
    { DATABASE_URL: "postgres://fixture@127.0.0.1:55432/another" },
    { DATABASE_URL: "bad" },
  ])
    assert.throws(() => assertLocalLanDevelopment({ ...env, ...changes }));
});
