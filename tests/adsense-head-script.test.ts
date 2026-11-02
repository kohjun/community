import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdSenseHeadScript } from "../src/components/adsense-head-script";
import { readAdvertisingConfiguration } from "../src/domain/advertising";
const env = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://sliper.kr",
  SLIPER_ADSENSE_CLIENT_ID: "ca-pub-7888129551635907",
  SLIPER_ADSENSE_ENABLED: "false",
};
const render = (overrides: Record<string, string | undefined> = {}) => {
  const config = readAdvertisingConfiguration({ ...env, ...overrides });
  return {
    config,
    html: renderToStaticMarkup(
      createElement(
        "html",
        null,
        createElement("head", null, createElement(AdSenseHeadScript, { config })),
        createElement("body"),
      ),
    ),
  };
};
test("production verification includes the exact async head script while manual ad units stay off", () => {
  const { config, html } = render();
  assert.equal(config.enabled, false);
  assert.equal(config.slots.inline, null);
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  assert.ok(
    head.includes(
      'src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7888129551635907"',
    ),
  );
  assert.ok(head.includes('async=""'));
  assert.ok(head.toLowerCase().includes('crossorigin="anonymous"'));
  assert.equal(head.split("<script").length - 1, 1);
  assert.equal(html.includes("<ins"), false);
});
test("local and malformed verification configurations do not load a remote script", () => {
  for (const override of [
    { NODE_ENV: "development" },
    { LOCAL_DATABASE: "1" },
    { APP_ORIGIN: "http://127.0.0.1:3000" },
    { SLIPER_ADSENSE_CLIENT_ID: "bad" },
  ])
    assert.equal(render(override).html.includes("<script"), false);
});
