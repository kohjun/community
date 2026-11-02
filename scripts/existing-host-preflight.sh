#!/usr/bin/env bash
# Read-only host inventory: no sudo, installs, changes, restart, env dumps or config contents.
set -u
port="${1:-13000}"
if [ "$#" -gt 1 ] || ! [[ "$port" =~ ^[0-9]{4,5}$ ]] || (( 10#$port < 1024 || 10#$port > 65535 )); then
  printf '%s\n' 'Usage: bash scripts/existing-host-preflight.sh [candidate-port 1024..65535]' >&2
  exit 2
fi
port=$((10#$port))
if [ "$(uname -s)" != Linux ]; then
  printf '%s\n' 'Unsupported host: run this read-only inventory on the Linux server.' >&2
  exit 2
fi
printf '%s\n' 'READ_ONLY_PREFLIGHT=1'
printf 'CANDIDATE_LOOPBACK_PORT=%s\n' "$port"
printf 'ARCH=%s\n' "$(uname -m)"
if [ -r /etc/os-release ]; then
  awk -F= '$1=="PRETTY_NAME" { print "OS=" substr($0,index($0,"=")+1) }' /etc/os-release
fi
printf 'CPU_LOGICAL=%s\n' "$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf unknown)"
if [ -r /proc/meminfo ]; then
  awk '/^MemTotal:/ {print "MEMORY_TOTAL_KIB=" $2} /^MemAvailable:/ {print "MEMORY_AVAILABLE_KIB=" $2}' /proc/meminfo
fi
printf '%s\n' 'DISK_ROOT_MIB:'
df -Pm / 2>/dev/null || true
printf '%s\n' 'RELEVANT_TCP_LISTENERS:'
if command -v ss >/dev/null 2>&1 && listeners=$(ss -H -ltnp 2>/dev/null); then
  printf '%s\n' "$listeners" | awk -v candidate=":$port$" '$4 ~ /:(80|443|3000)$/ || $4 ~ candidate'
  if printf '%s\n' "$listeners" | awk -v candidate=":$port$" '$4 ~ candidate {used=1} END {exit !used}'; then
    printf '%s\n' 'CANDIDATE_PORT_STATUS=in-use'
  else
    printf '%s\n' 'CANDIDATE_PORT_STATUS=not-listening-at-check-time'
  fi
else
  printf '%s\n' 'CANDIDATE_PORT_STATUS=unknown (ss unavailable or permission denied)'
fi
printf '%s\n' 'PROXY_BINARIES:'
for proxy in nginx caddy; do
  if command -v "$proxy" >/dev/null 2>&1; then
    if [ "$proxy" = nginx ]; then nginx -v 2>&1; else caddy version; fi
  fi
done
printf '%s\n' 'PROXY_SERVICE_STATE:'
if command -v systemctl >/dev/null 2>&1; then
  systemctl show nginx.service caddy.service --property=Id,ActiveState,SubState --no-pager 2>/dev/null || true
fi
printf '%s\n' 'DOCKER_VERSION:'
if command -v docker >/dev/null 2>&1; then
  docker version --format '{{.Server.Version}}' 2>/dev/null || printf '%s\n' 'daemon unavailable to this user'
  docker compose version --short 2>/dev/null || true
  printf '%s\n' 'RUNNING_CONTAINERS (names/images/published-ports only):'
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || true
else
  printf '%s\n' 'docker unavailable'
fi
printf '%s\n' 'INSPECTION_ONLY=1 (no firewall, certificate, DNS, service or configuration changes)'
