#!/usr/bin/env bash
set -euo pipefail
sliper_node_version="${1:-}"
sliper_expected_sha="${2:-}"
if [ "$#" -ne 2 ] || ! [[ "$sliper_node_version" =~ ^v24\.[0-9]+\.[0-9]+$ ]] || ! [[ "$sliper_expected_sha" =~ ^[a-f0-9]{64}$ ]]; then
  printf '%s\n' 'Usage: native-runtime-setup.sh v24.x.y official-sha256' >&2
  exit 2
fi
[ "$(id -u)" = 0 ] && [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || exit 1
sliper_kernel=$(uname -r | cut -d- -f1)
sliper_glibc=$(getconf GNU_LIBC_VERSION | awk '{print $2}')
[ "$(printf '%s\n' 4.18 "$sliper_kernel" | sort -V | head -n 1)" = 4.18 ] || { printf 'Kernel below Node24 minimum\n' >&2; exit 1; }
[ "$(printf '%s\n' 2.28 "$sliper_glibc" | sort -V | head -n 1)" = 2.28 ] || { printf 'glibc below Node24 minimum\n' >&2; exit 1; }
if [ -e /opt/sliper ] && [ ! -f /opt/sliper/.sliper-native-managed ]; then
  printf '%s\n' 'Refusing an existing unmanaged /opt/sliper directory.' >&2; exit 1
fi
if getent passwd sliper >/dev/null; then
  [ "$(getent passwd sliper | cut -d: -f6)" = /var/lib/sliper ] || { printf 'Unexpected existing sliper account\n' >&2; exit 1; }
  [ "$(id -u sliper)" -ne 0 ] || exit 1
else
  useradd --system --user-group --home-dir /var/lib/sliper --shell /usr/sbin/nologin sliper
fi
install -d -m 0755 /opt/sliper /opt/sliper/runtime /opt/sliper/releases /opt/sliper/runtime/downloads
printf '%s\n' 'sliper-native-v1' > /opt/sliper/.sliper-native-managed
install -d -m 0750 -o root -g sliper /etc/sliper
install -d -m 0750 -o sliper -g sliper /var/lib/sliper /var/lib/sliper/web-cache
sliper_archive="node-${sliper_node_version}-linux-x64.tar.xz"
sliper_tar="/opt/sliper/runtime/downloads/$sliper_archive"
if [ ! -f "$sliper_tar" ]; then
  curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 10 --max-time 180 "https://nodejs.org/dist/${sliper_node_version}/${sliper_archive}" -o "${sliper_tar}.partial"
  printf '%s  %s\n' "$sliper_expected_sha" "${sliper_tar}.partial" | sha256sum --check --status
  mv -- "${sliper_tar}.partial" "$sliper_tar"
fi
printf '%s  %s\n' "$sliper_expected_sha" "$sliper_tar" | sha256sum --check --status
if [ ! -d "/opt/sliper/runtime/node-${sliper_node_version}-linux-x64" ]; then
  tar -xJf "$sliper_tar" -C /opt/sliper/runtime --no-same-owner
fi
if [ -e /opt/sliper/runtime/node ] || [ -L /opt/sliper/runtime/node ]; then
  [ -L /opt/sliper/runtime/node ] || { printf 'Unexpected runtime node path\n' >&2; exit 1; }
  case "$(readlink -f /opt/sliper/runtime/node)" in /opt/sliper/runtime/node-v24.*-linux-x64) ;; *) printf 'Unexpected Node runtime link\n' >&2; exit 1;; esac
fi
ln -sfn -- "/opt/sliper/runtime/node-${sliper_node_version}-linux-x64" /opt/sliper/runtime/node
printf 'ISOLATED_NODE_VERSION='; /opt/sliper/runtime/node/bin/node --version
printf 'ISOLATED_NPM_VERSION='; /opt/sliper/runtime/node/bin/node /opt/sliper/runtime/node/lib/node_modules/npm/bin/npm-cli.js --version
printf 'EXISTING_SYSTEM_NODE='; /usr/bin/node --version
printf 'KERNEL=%s\nGLIBC=%s\n' "$sliper_kernel" "$sliper_glibc"
printf '%s\n' 'RUNTIME_READY=1 (no global Node, PM2, Nginx or firewall changes)'
