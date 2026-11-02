import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";

const release = process.env.SLIPER_TEST_RELEASE ?? "local";
if (!/^[A-Za-z0-9_.-]+$/.test(release)) throw new Error("Invalid test image tag");
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  }).trim();
const lockedRuntime = [
  "--network",
  "none",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
];
const isolatedNode = (image: string, code: string) =>
  JSON.parse(
    docker(
      "run",
      "--rm",
      ...lockedRuntime,
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=256m,uid=1000,gid=1000,mode=1770",
      "--entrypoint",
      "node",
      image,
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      code,
    ),
  );

// All checks deliberately have no network and never connect to the real DB, Auth or Storage.
test(
  "Linux standalone is non-root, excludes private/worker files and answers dependency-free health",
  { timeout: 60_000 },
  async () => {
    const name = `sliper-web-fixture-${randomUUID()}`;
    const token = randomUUID();
    try {
      docker(
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--label",
        `sliper.test.owner=${token}`,
        ...lockedRuntime,
        "--env",
        "APP_ORIGIN=https://sliper.invalid",
        `sliper-web:${release}`,
      );
      let response:
        { get: number; head: number; cookie: string | null; cache: string | null } | undefined;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          response = JSON.parse(
            docker(
              "exec",
              name,
              "node",
              "--input-type=module",
              "-e",
              `const a=await fetch('http://127.0.0.1:3000/api/health');const b=await fetch('http://127.0.0.1:3000/api/health',{method:'HEAD'});console.log(JSON.stringify({get:a.status,head:b.status,cookie:a.headers.get('set-cookie'),cache:a.headers.get('cache-control')}))`,
            ),
          );
          if (response?.get === 200) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(response?.get, 200);
      assert.equal(response?.head, 200);
      assert.equal(response?.cookie, null);
      assert.match(response?.cache ?? "", /no-store/);
      const audit = JSON.parse(
        docker(
          "exec",
          name,
          "node",
          "--input-type=module",
          "-e",
          String.raw`
import fs from 'node:fs';import path from 'node:path';let files=0;const forbidden=[];const links=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())links.push(p);else if(e.isDirectory())walk(p);else {files++;if(e.name.startsWith('.env')||/\.(pem|p12|pfx|key)$/.test(e.name)||p.includes('/.git/')||p.includes('/.local/')||p.includes('/ffmpeg-static/')||p.includes('/@ffprobe-installer/'))forbidden.push(p);}}}
walk('/app');console.log(JSON.stringify({uid:process.getuid(),files,forbidden,links}));`,
        ),
      );
      assert.equal(audit.uid, 1000);
      assert.deepEqual(audit.forbidden, []);
      assert.deepEqual(audit.links, []);
      assert.ok(audit.files > 100);
      console.log(JSON.stringify({ image: "web", ...audit, network: "none", health: response }));
    } finally {
      try {
        const [container] = JSON.parse(docker("container", "inspect", name));
        if (container.Config.Labels?.["sliper.test.owner"] === token)
          docker("container", "rm", "--force", name);
      } catch {}
    }
  },
);

test(
  "Linux notification image imports worker and health CLI rejects missing/stopped success",
  { timeout: 60_000 },
  () => {
    const result = isolatedNode(
      `sliper-notifications:${release}`,
      String.raw`
import assert from 'node:assert/strict';import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {workerHeartbeat,workerIsHealthy,workerHealthPath,WORKER_HEALTH_MAX_AGE} from './src/server/worker-health.ts';
const {startPushWorker}=await import('./src/server/push-worker-loop.ts');assert.equal(typeof startPushWorker,'function');
const cli=()=>spawnSync(process.execPath,['--import','tsx','scripts/worker-health.ts','notification'],{encoding:'utf8'});
assert.equal(cli().status,1);const h=await workerHeartbeat('notification');assert.equal(cli().status,1);
await h.success();assert.equal(await workerIsHealthy('notification'),true);assert.equal(cli().status,0);
const old=Date.now()-WORKER_HEALTH_MAX_AGE.notification-1_000,record=JSON.parse(await readFile(workerHealthPath('notification'),'utf8'));await writeFile(workerHealthPath('notification'),JSON.stringify({...record,startedAt:old-1_000,succeededAt:old}));assert.equal(cli().status,1);
await h.stop();assert.equal(cli().status,1);assert.equal(process.getuid(),1000);
console.log(JSON.stringify({image:'notifications',uid:process.getuid(),imported:true,healthTransitions:['missing','starting','healthy','stale','stopped'],network:'none'}));`,
    );
    assert.equal(result.imported, true);
    assert.equal(result.uid, 1000);
    console.log(JSON.stringify(result));
  },
);

test(
  "Linux video image executes FFmpeg/FFprobe and app transcoding on synthetic media",
  { timeout: 60_000 },
  () => {
    const result = isolatedNode(
      `sliper-video:${release}`,
      String.raw`
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';import path from 'node:path';
import {compressVideo} from './src/server/video-transcoding-core.ts';
import {workerHeartbeat,workerHealthPath,WORKER_HEALTH_MAX_AGE} from './src/server/worker-health.ts';
import {writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const cli=()=>spawnSync(process.execPath,['--import','tsx','scripts/worker-health.ts','video'],{encoding:'utf8'});
assert.equal(cli().status,1);const health=await workerHeartbeat('video');assert.equal(cli().status,1);await health.success();assert.equal(cli().status,0);
const old=Date.now()-WORKER_HEALTH_MAX_AGE.video-1_000,record=JSON.parse(await readFile(workerHealthPath('video'),'utf8'));await writeFile(workerHealthPath('video'),JSON.stringify({...record,startedAt:old-1_000,succeededAt:old}));assert.equal(cli().status,1);await health.stop();assert.equal(cli().status,1);
const require=createRequire(import.meta.url),ffmpeg=require('ffmpeg-static'),ffprobe=require('@ffprobe-installer/ffprobe').path;
execFileSync(ffmpeg,['-version'],{stdio:'ignore'});execFileSync(ffprobe,['-version'],{stdio:'ignore'});
const directory=await mkdtemp('/tmp/sliper-container-media-'),input=path.join(directory,'source.mp4');
try {execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=320x180:rate=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-y',input],{stdio:'ignore'});
const result=await compressVideo(await readFile(input));assert.ok(result.bytes.length>0);assert.ok(result.width<=1280);assert.ok(result.height<=720);assert.equal(process.getuid(),1000);
console.log(JSON.stringify({image:'video',uid:process.getuid(),ffmpeg:true,ffprobe:true,syntheticVideo:{bytes:result.bytes.length,width:result.width,height:result.height},healthTransitions:['missing','starting','healthy','stale','stopped'],network:'none'}));
}finally{await unlink(input);await rmdir(directory);}`,
    );
    assert.equal(result.ffmpeg, true);
    assert.equal(result.ffprobe, true);
    assert.ok(result.syntheticVideo.bytes > 0);
    console.log(JSON.stringify(result));
  },
);
