import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adSenseOriginMatches,
  adSenseScriptSource,
  canRequestAdSenseUnit,
  createAdSenseVisitScope,
  initializeAdSenseUnit,
  watchAdSenseVisibility,
  type AdSenseBrowserQueue,
  type AdSenseMeasurement,
  type AdSenseVisibilityEnvironment,
} from "../src/lib/adsense-runtime";

const visible: AdSenseMeasurement = {
  connected: true,
  visible: true,
  inViewport: true,
  width: 360,
  height: 120,
};
const node = (status: string | null = null) => ({ getAttribute: () => status });

function queueLength(browser: AdSenseBrowserQueue): number {
  assert.ok(Array.isArray(browser.adsbygoogle));
  return browser.adsbygoogle.length;
}

function visibilityHarness(initial: AdSenseMeasurement, observers = true) {
  let measurement = initial;
  let intersection: ((visible: boolean) => void) | null = null;
  let resize: (() => void) | null = null;
  let viewport: (() => void) | null = null;
  const disposed = { intersection: 0, resize: 0, viewport: 0 };
  const environment: AdSenseVisibilityEnvironment<object> = {
    measure: () => measurement,
    observeIntersection: (_, update) => {
      if (!observers) return null;
      intersection = update;
      return () => {
        disposed.intersection += 1;
        intersection = null;
      };
    },
    observeResize: (_, update) => {
      if (!observers) return null;
      resize = update;
      return () => {
        disposed.resize += 1;
        resize = null;
      };
    },
    onViewportChange: (update) => {
      viewport = update;
      return () => {
        disposed.viewport += 1;
        viewport = null;
      };
    },
  };
  return {
    environment,
    disposed,
    measurement: (value: AdSenseMeasurement) => {
      measurement = value;
    },
    intersect: (value: boolean) => intersection?.(value),
    resize: () => resize?.(),
    viewport: () => viewport?.(),
  };
}

test("script source accepts only a publisher ID and cannot become an arbitrary script URL", () => {
  const source = adSenseScriptSource("ca-pub-1234567890123456");
  assert.equal(
    source,
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456",
  );
  for (const id of [
    null,
    "",
    "https://malicious.invalid/script.js",
    "ca-pub-1",
    "ca-pub-1234567890123456&x=1",
  ]) {
    assert.equal(adSenseScriptSource(id), null);
  }
});

test("browser activation requires the exact HTTPS origin and never trusts unknown or local origins", () => {
  assert.equal(adSenseOriginMatches("https://sliper.com", "https://sliper.com"), true);
  for (const origin of [
    null,
    "http://sliper.com",
    "https://www.sliper.com",
    "https://sliper.com:444",
    "http://127.0.0.1:3000",
  ]) {
    assert.equal(adSenseOriginMatches("https://sliper.com", origin), false);
  }
  for (const origin of [
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://dev.localhost",
    "https://sliper.com/path",
    "https://user:pass@sliper.com",
  ]) {
    assert.equal(adSenseOriginMatches(origin, origin), false);
  }
});

test("hidden, detached, zero-sized and offscreen units do not request; sidebars require their fixed size", () => {
  assert.equal(canRequestAdSenseUnit(visible, "inline"), true);
  for (const changed of [
    { connected: false },
    { visible: false },
    { inViewport: false },
    { width: 0 },
    { height: 0 },
    { width: Number.NaN },
    { height: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(canRequestAdSenseUnit({ ...visible, ...changed }, "inline"), false);
  }
  assert.equal(canRequestAdSenseUnit({ ...visible, width: 160, height: 600 }, "left"), true);
  assert.equal(canRequestAdSenseUnit({ ...visible, width: 159, height: 600 }, "left"), false);
  assert.equal(canRequestAdSenseUnit({ ...visible, width: 160, height: 599 }, "right"), false);
});

test("each DOM node pushes once while independent placements can each initialize", () => {
  const browser: AdSenseBrowserQueue = {};
  const first = node();
  assert.equal(
    initializeAdSenseUnit(first, browser, { ...visible, width: 0 }, "inline"),
    "ineligible",
  );
  assert.equal(browser.adsbygoogle, undefined);
  assert.equal(initializeAdSenseUnit(first, browser, visible, "inline"), "requested");
  assert.equal(initializeAdSenseUnit(first, browser, visible, "inline"), "already-requested");
  assert.equal(initializeAdSenseUnit(node(), browser, visible, "inline"), "requested");
  assert.equal(queueLength(browser), 2);
  assert.equal(
    initializeAdSenseUnit(node("done"), browser, visible, "inline"),
    "already-requested",
  );
  assert.equal(queueLength(browser), 2);
});

test("Google queue errors consume the node and cannot trigger a repeated ad request", () => {
  let calls = 0;
  const browser: AdSenseBrowserQueue = {
    adsbygoogle: {
      push: () => {
        calls += 1;
        throw new Error("blocked");
      },
    },
  };
  const failedNode = node();
  assert.equal(initializeAdSenseUnit(failedNode, browser, visible, "inline"), "blocked");
  assert.equal(initializeAdSenseUnit(failedNode, browser, visible, "inline"), "already-requested");
  assert.equal(calls, 1);
});

test("intersection and resize visibility wait for a real visible size then release every observer", () => {
  const browser: AdSenseBrowserQueue = {};
  const ad = node();
  const runtime = visibilityHarness({ ...visible, width: 0 });
  const stop = watchAdSenseVisibility(
    ad,
    "inline",
    runtime.environment,
    (measurement) => initializeAdSenseUnit(ad, browser, measurement, "inline") !== "ineligible",
  );
  runtime.intersect(true);
  assert.equal(browser.adsbygoogle, undefined);
  runtime.measurement(visible);
  runtime.resize();
  assert.equal(queueLength(browser), 1);
  assert.deepEqual(runtime.disposed, { intersection: 1, resize: 1, viewport: 1 });
  runtime.intersect(true);
  runtime.resize();
  runtime.viewport();
  stop();
  assert.equal(queueLength(browser), 1);
  assert.deepEqual(runtime.disposed, { intersection: 1, resize: 1, viewport: 1 });
});

test("fallback viewport checks work without observer APIs and canceled units never initialize", () => {
  const browser: AdSenseBrowserQueue = {};
  const first = node();
  const runtime = visibilityHarness({ ...visible, inViewport: false }, false);
  watchAdSenseVisibility(
    first,
    "inline",
    runtime.environment,
    (measurement) => initializeAdSenseUnit(first, browser, measurement, "inline") !== "ineligible",
  );
  assert.equal(browser.adsbygoogle, undefined);
  runtime.measurement(visible);
  runtime.viewport();
  assert.equal(queueLength(browser), 1);
  assert.deepEqual(runtime.disposed, { intersection: 0, resize: 0, viewport: 1 });
  const canceled = visibilityHarness({ ...visible, width: 0 });
  const second = node();
  const stop = watchAdSenseVisibility(
    second,
    "inline",
    canceled.environment,
    (measurement) => initializeAdSenseUnit(second, browser, measurement, "inline") !== "ineligible",
  );
  stop();
  canceled.measurement(visible);
  canceled.intersect(true);
  canceled.resize();
  assert.equal(queueLength(browser), 1);
});

test("StrictMode-style effect cleanup and replay do not initialize the same DOM node twice", () => {
  const browser: AdSenseBrowserQueue = {};
  const ad = node();
  const first = visibilityHarness(visible);
  const initialize = (measurement: AdSenseMeasurement) =>
    initializeAdSenseUnit(ad, browser, measurement, "inline") !== "ineligible";
  const firstStop = watchAdSenseVisibility(ad, "inline", first.environment, initialize);
  first.intersect(true);
  firstStop();
  const replay = visibilityHarness(visible);
  watchAdSenseVisibility(ad, "inline", replay.environment, initialize);
  replay.intersect(true);
  assert.equal(queueLength(browser), 1);
  assert.deepEqual(replay.disposed, { intersection: 1, resize: 1, viewport: 1 });
});

test("synchronous observer delivery also stops observers registered after the first request", () => {
  let requests = 0;
  const disposed = { intersection: 0, resize: 0, viewport: 0 };
  const environment: AdSenseVisibilityEnvironment<object> = {
    measure: () => visible,
    observeIntersection: (_, update) => {
      update(true);
      return () => {
        disposed.intersection += 1;
      };
    },
    observeResize: () => () => {
      disposed.resize += 1;
    },
    onViewportChange: () => () => {
      disposed.viewport += 1;
    },
  };
  const stop = watchAdSenseVisibility({}, "inline", environment, () => {
    requests += 1;
    return true;
  });
  stop();
  assert.equal(requests, 1);
  assert.deepEqual(disposed, { intersection: 1, resize: 1, viewport: 1 });
});

test("a placement remount on the same location never refreshes an ad; a real navigation creates a new visit", () => {
  const scope = createAdSenseVisitScope();
  const first = node();
  assert.equal(scope.claim("/stories", "inline", first), true);
  assert.equal(scope.claim("/stories", "inline", first), true);
  assert.equal(scope.claim("/stories", "inline", node()), false);
  assert.equal(scope.claim("/stories", "left", node()), true);
  scope.navigate("/stories?view=mine");
  assert.equal(scope.claim("/stories", "inline", node()), true);
  assert.equal(scope.claim("/stories", "inline", node()), false);
  assert.equal(scope.claim("/lightning", "inline", node()), true);
  assert.equal(scope.claim("/lightning?tag=party", "inline", node()), true);
});
