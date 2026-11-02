# Native Sliper runtime on the existing Ncloud host

The base units add three Sliper application services. The optional IP HTTPS layer adds a fourth dedicated TLS service and one narrowly scoped Nginx IP/ACME virtual host. Existing site configurations, PM2 and system Node remain independent. These files are templates; use the actual deployment report for verified state.

## Layout

```text
/opt/sliper/runtime/node/             verified official Node 24 Linux x64 distribution
/opt/sliper/releases/RELEASE/
  standalone/server.js               Next standalone output root
  standalone/.next/static/           copied from the SAME build
  standalone/public/                 public assets
  standalone/.next/cache             symlink to /var/lib/sliper/web-cache
  worker/package.json                lock-matched worker source project
  worker/package-lock.json
  worker/tsconfig.json
  worker/src/
  worker/scripts/push-worker.ts
  worker/scripts/video-worker.ts
  worker/scripts/worker-health.ts
  worker/node_modules/                installed on Linux, not copied from Windows
/opt/sliper/current                   symlink to one complete release
/etc/sliper/runtime.env               root:sliper, 0640, runtime credentials only
/var/lib/sliper/                      dedicated sliper account home/app state
/run/sliper-web/                      service-owned temporary data
/run/sliper-notifications/            progress health record
/run/sliper-video/                    video temporary data and progress health record
```

Create a dedicated system account named sliper with its home at /var/lib/sliper and a non-login shell. Verify an existing account/directory of that name belongs to this deployment before reusing it. Keep releases and the Node runtime root-owned and read-only to the sliper user. Do not recursively chown a parent containing another application.

The three units read the same protected runtime environment. Use the restricted Supabase application role, private Storage server configuration, cloud-only flags and external notification worker mode. Do not copy migration-owner credentials, backup administrator URLs, Windows development env files or test-login configuration into the release or runtime environment. No .env files belong in either release directory.

StateDirectory creates /var/lib/sliper, but prepare its web-cache child with owner sliper before linking it from the standalone release. ProtectSystem=strict makes release files read-only; web writes are allowed only to app state and the service runtime directory. If future Next ISR features need writes beyond .next/cache, review that cache configuration rather than making all release files writable.

The units use TMPDIR under their RuntimeDirectory. Health CLI calls from the host must use the matching value. These are local paths, not persistent user-media storage; Supabase remains the content store. PrivateTmp also isolates incidental /tmp use. Do not set MemoryDenyWriteExecute or an unverified syscall filter: V8 JIT and FFmpeg subprocesses need their normal execution facilities.

## Compatibility and binary verification

Keep the existing /usr/bin/node (currently Node 20) and PM2 untouched. Download the chosen exact Node 24 release under /opt/sliper/runtime, verify its archive against Node's official release checksums, and point /opt/sliper/runtime/node at that verified runtime. Do not run a global Node installer or change /usr/bin symlinks/PATH for existing services.

The official Node 24 ABI table lists Linux x64 kernel >=4.18 and glibc >=2.28, with Ubuntu 20.04 as an example. It also excludes vendor-end-of-life operating systems regardless of that table. Inspect uname -r, ldd --version and the host's Ubuntu Pro/ESM status; binary startup success is not an OS security-support certificate. Ubuntu 20.04's standard support ended, so assess ESM/host migration separately without upgrading this shared host during deployment.

- [Node 24 BUILDING: platforms and official binaries](https://github.com/nodejs/node/blob/v24.x/BUILDING.md)
- [Focal systemd 245 execution options](https://manpages.ubuntu.com/manpages/focal/man5/systemd.exec.5.html)
- [Focal systemd service options](https://manpages.ubuntu.com/manpages/focal/man5/systemd.service.5.html)
- [Ubuntu 20.04 support](https://ubuntu.com/20-04)

## Build and stage

Build with the isolated Node 24 runtime and the pinned lockfile on Linux. NEXT_PUBLIC Supabase/map identifiers are public build inputs; private server credentials are runtime inputs. Copy the standalone build, its matching .next/static and public into standalone/. Create the worker tree from the same source revision and install Linux dependencies from the same lockfile. Workers require tsx and the video packages; when using the current lockfile, npm ci --include=dev provides the tsx entrypoint. Ensure the installed FFprobe path is executable by sliper: its installer may leave an owner-only execute mode. Never chmod or replace the existing application's dependencies.

Before installing units, test the isolated runtime, run the same trace/artifact audit as the container flow, and exercise FFmpeg/FFprobe plus a tiny synthetic conversion as sliper. Do not start a second notification/video replica on the live Supabase just to validate imports.

## Install only these units

After source, runtime, protected env and cache directories are prepared, copy these exact three unit files to /etc/systemd/system/. Run:

```sh
systemd-analyze verify /etc/systemd/system/sliper-web.service /etc/systemd/system/sliper-notifications.service /etc/systemd/system/sliper-video.service
systemctl daemon-reload
systemctl enable --now sliper-web.service sliper-notifications.service sliper-video.service
systemctl is-active sliper-web.service sliper-notifications.service sliper-video.service
curl --fail http://127.0.0.1:13000/api/health
```

Verify on the target systemd version. A local Windows file check is not a substitute for systemd-analyze on the Linux host. Type=exec confirms that the process was executed; it does not certify DB/Auth/Storage readiness. Port 13000 must be confirmed unused immediately before start. Check the existing application's 3000 and Nginx 80/443 separately after startup.

Changing a unit's EnvironmentFile or a release link requires restarting the affected Sliper service. Installing a release does not require restarting PM2, Nginx or the server. Ncloud ACG and any host firewall still need an explicit rule for the chosen public port, preserving other rules.

## State and health

```sh
cd /opt/sliper/current/worker
TMPDIR=/run/sliper-notifications /opt/sliper/runtime/node/bin/node --import tsx scripts/worker-health.ts notification
TMPDIR=/run/sliper-video /opt/sliper/runtime/node/bin/node --import tsx scripts/worker-health.ts video
```

Run as the sliper user or an authorized administrator; runtime directories are private. Notification progress expires after 180 seconds and video progress after 900 seconds. These scripts inspect progress files/PIDs without DB access. systemd only restarts exited/failed processes; an unhealthy progress record is not an automatic restart trigger. Queue failures and stale leases also require the existing admin health screen and an external operational alert.

The notification unit allows 180 seconds and video 300 seconds for graceful shutdown. A forced stop still relies on durable lease recovery; external push provider acceptance followed by a missing DB acknowledgement can produce a repeated delivery. Avoid kill -9 as normal deployment behavior.

Journald remains under the host's existing retention policy. These units do not globally change journald storage/retention, and journal messages must not contain env values, cookies or private message bodies. If rotating per-unit file logs is later needed, add an explicit Sliper-only policy rather than modifying existing service logs.

## Rollback and HTTPS stage

Retain the previous complete release. Change only /opt/sliper/current to a prepared prior release and restart only these Sliper units after schema compatibility review. Do not restore the database or delete a release while a running process still uses it.

The current public-IP HTTP port is for connectivity/public-page verification. The existing auth policy requires trusted HTTPS for non-loopback authentication; do not relax secure cookies or auth checks to make HTTP appear production-ready. Sliper's own HTTPS/certificate stage is independent of the existing service's domain and proxy.


## Dedicated public-IP HTTPS layer

The actual 2026-10-27 deployment uses trusted IP HTTPS on the same public TCP13000. See [verified results, Auth dashboard task and device checks](../../docs/NCLOUD_IP_HTTPS_2026-10-27.md).

- `Caddyfile.ip-https` → `/etc/sliper-tls/Caddyfile`, root:sliper-tls0640.
- `sliper-tls.service` → the separate non-login sliper-tls account and private0700 certificate state. It never inherits application runtime credentials.
- `sliper-web-https.conf` → `/etc/systemd/system/sliper-web.service.d/https-backend.conf`, keeping Next on127.0.0.1:13001.
- `sliper-ip-acme.nginx.conf` → replace the public-IP marker and add a new site after existing sites, proxying only the IP Host ACME path to127.0.0.1:13080. Validate before graceful Nginx reload. Never replace existing site files or stop80/443 for validation.

`/etc/sliper-tls/runtime.env` contains public listener parameters only: SLIPER_TLS_HOST, SLIPER_TLS_PORT, SLIPER_TLS_BIND_ADDRESS and SLIPER_UPSTREAM_PORT. Staging can bind127.0.0.1:13443 while existing HTTP13000 continues. The final values are public13000 and upstream13001. Verify the official pinned Caddy archive SHA256, Linux adaptation/validation and systemd compatibility before starting.

Public-IP certificates use the explicit Let's Encrypt shortlived profile and persist across restarts. Keep the IP HTTP-01 route on80 reachable for automatic renewal. The old HTTP13000 URL redirects to HTTPS on the same port. Do not advertise UDP HTTP/3 without opening and verifying that separate protocol.

The native source allowlist now includes `scripts/provision-production-push.ts` and its single library dependency. Only root on Linux may apply it to the protected runtime.env. It preserves valid existing VAPID keys and refuses ambiguous or partial values. It never prints private keys, sends notifications or restarts services.


## Lightweight external monitoring endpoint

The deployed `/ops/health` route proxies to a separate non-login `sliper-monitor` user on127.0.0.1:13002. A root oneshot probe checks only fixed Sliper services, protected worker progress, the managed certificate and host resource thresholds. It uses CAP_DAC_READ_SEARCH for the private worker/certificate files, never application credentials. A30-second timer refreshes the root-owned0640 status file under root:sliper-monitor0750 `/var/lib/sliper-monitor`.

Install `sliper-monitor.py` as root-owned `/opt/sliper/ops/sliper-monitor.py`. Install `sliper-monitor-probe.service`, `sliper-monitor.timer` and `sliper-monitor.service` only after checking user/directory/port collisions. The unprivileged HTTP unit must NOT own a StateDirectory; it reads the root-owned state. Validate with host Python3.8+, systemd-analyze and Caddy before enabling.

The public endpoint reveals status only and fails503 on stale snapshots. It performs no new Supabase queries. Configure an independent external HTTP monitor and Email destination separately; local timers cannot alert during a total host outage. See [actual backup/restore, health failure and recovery verification](../../docs/OPERATIONS_BACKUP_MONITORING_2026-10-27.md).
