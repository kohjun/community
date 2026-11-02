import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Explicit integration command only; every container uses an isolated fake upstream.
// No production environment files, application requests, real domains or ACME issuance.
test(
  "production proxy preserves Range/SSE, bounds bodies and redacts error requests",
  { timeout: 90_000 },
  async () => {
    const token = randomUUID();
    const network = `sliper-proxy-fixture-${token}`;
    const upstream = `${network}-web`;
    const proxy = `${network}-caddy`;
    const directory = path.resolve(".local", network);
    const owner = "sliper.test.owner";
    const docker = (...args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 2 * 1024 * 1024,
      }).trim();
    const removeOwned = (kind: "container" | "network", name: string) => {
      try {
        const [value] = JSON.parse(docker(kind, "inspect", name));
        const labels = kind === "container" ? value.Config.Labels : value.Labels;
        if (labels?.[owner] === token)
          docker(kind, "rm", ...(kind === "container" ? ["--force"] : []), name);
      } catch {
        /* A failed creation may leave nothing to remove. */
      }
    };
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "upstream.cjs"),
      String.raw`
const http = require('node:http');
let active;
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://web');
  if(url.pathname==='/stream') { active=res;res.setHeader('Content-Type','text/event-stream');res.flushHeaders();res.write('data: ready\n\n');return; }
  if(url.pathname==='/release-stream') { active?.end('data: done\n\n');res.end('released');return; }
  if(url.pathname==='/video') {res.writeHead(206,{'Content-Range':'bytes 0-1/20','Content-Length':'2','Content-Type':'video/mp4','Accept-Ranges':'bytes'});res.end(Buffer.from([1,2]));return;}
  if(url.pathname==='/error') { req.socket.destroy();return; }
  if(url.pathname==='/upload') {let bytes=0;req.on('data',chunk=>bytes+=chunk.length);req.on('end',()=>res.end(String(bytes)));req.on('error',()=>res.destroy());return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({host:req.headers.host,forwardedHost:req.headers['x-forwarded-host'],forwardedProto:req.headers['x-forwarded-proto']}));
}).listen(3000,'0.0.0.0');
`,
      "utf8",
    );
    execFileSync(process.execPath, ["--check", path.join(directory, "upstream.cjs")]);
    try {
      docker("network", "create", "--label", `${owner}=${token}`, network);
      docker(
        "run",
        "--detach",
        "--rm",
        "--name",
        upstream,
        "--label",
        `${owner}=${token}`,
        "--network",
        network,
        "--network-alias",
        "web",
        "--mount",
        `type=bind,source=${path.join(directory, "upstream.cjs")},target=/fixture.cjs,readonly`,
        "node:24-bookworm-slim",
        "node",
        "/fixture.cjs",
      );
      docker(
        "run",
        "--detach",
        "--rm",
        "--name",
        proxy,
        "--label",
        `${owner}=${token}`,
        "--network",
        network,
        "--publish",
        "127.0.0.1::8080",
        "--env",
        "SLIPER_DOMAIN=http://:8080",
        "--env",
        "ACME_EMAIL=admin@example.invalid",
        "--mount",
        `type=bind,source=${path.resolve("deploy/Caddyfile")},target=/etc/caddy/Caddyfile,readonly`,
        "caddy:2.11.7-alpine",
      );
      const port = docker("port", proxy, "8080/tcp").split(":").at(-1)!;
      const base = `http://127.0.0.1:${port}`;
      const request = (resource: string, init: RequestInit = {}) =>
        fetch(base + resource, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(10_000),
        });
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          if ((await request("/ready", { signal: AbortSignal.timeout(1_000) })).status === 200) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, "isolated upstream and proxy start");
      const forwarded = await (
        await request("/headers", {
          headers: { "x-forwarded-proto": "https", "x-forwarded-host": "untrusted.invalid" },
        })
      ).json();
      assert.equal(forwarded.host, `127.0.0.1:${port}`);
      assert.equal(forwarded.forwardedHost, `127.0.0.1:${port}`);
      assert.equal(forwarded.forwardedProto, "http");
      const range = await request("/video", { headers: { Range: "bytes=0-1" } });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get("content-range"), "bytes 0-1/20");
      assert.deepEqual([...new Uint8Array(await range.arrayBuffer())], [1, 2]);
      const stream = await request("/stream");
      const reader = stream.body!.getReader();
      const first = await reader.read();
      assert.equal(new TextDecoder().decode(first.value), "data: ready\n\n");
      await (await request("/release-stream")).text();
      let tail = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        tail += new TextDecoder().decode(chunk.value);
      }
      assert.equal(tail, "data: done\n\n");
      let remaining = 64_000_001;
      const payload = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!remaining) {
            controller.close();
            return;
          }
          const length = Math.min(1024 * 1024, remaining);
          remaining -= length;
          controller.enqueue(new Uint8Array(length));
        },
      });
      const oversized = await request("/upload", {
        method: "POST",
        body: payload,
        duplex: "half",
      } as RequestInit);
      assert.equal(oversized.status, 413);
      await oversized.text();
      const failed = await request("/error?code=fixture-oauth-code", {
        headers: { Cookie: "fixture-session-cookie", Authorization: "Bearer fixture-auth-token" },
      });
      assert.equal(failed.status, 502);
      await failed.text();
      const logs = docker("logs", proxy);
      assert.equal(logs.includes("fixture-oauth-code"), false);
      assert.equal(logs.includes("fixture-session-cookie"), false);
      assert.equal(logs.includes("fixture-auth-token"), false);
      assert.equal(logs.includes("[redacted]"), true);
    } finally {
      removeOwned("container", proxy);
      removeOwned("container", upstream);
      removeOwned("network", network);
      assert.equal(path.dirname(directory), path.resolve(".local"));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
