#!/usr/bin/env bash
# Operator-only end-to-end alert drill. Confirm intended email recipients before --start.
# Only the monitor snapshot/probe is affected; application/TLS/delivery services stay running.
set -euo pipefail
umask 077
[[ $(id -u) = 0 && -f /opt/sliper/.sliper-native-managed ]]
[[ $# = 1 && ( "$1" = --start || "$1" = --recover ) ]]
exec 9>/run/sliper-monitor-email-drill.lock
flock -n 9
state=/var/lib/sliper-monitor/mail-drill.json
recover() {
  systemctl start sliper-monitor-probe.service
  systemctl start sliper-monitor.timer
  if [[ -f "$state" && ! -L "$state" ]]; then
    recovery_unit=$(python3 -B - <<'PY'
import json,pathlib,re
v=json.loads(pathlib.Path('/var/lib/sliper-monitor/mail-drill.json').read_text())
n=v.get('unit','')
assert re.fullmatch(r'sliper-monitor-mail-recover-[0-9]{10,}',n)
print(n)
PY
)
    systemctl stop "$recovery_unit.timer" || true
    python3 -B - <<'PY'
import json,pathlib,time,os
p=pathlib.Path('/var/lib/sliper-monitor/mail-drill.json');v=json.loads(p.read_text());v['recoveredAt']=time.time();v['active']=False
t=p.with_suffix('.tmp');t.write_text(json.dumps(v));os.chmod(t,0o600);os.replace(t,p)
PY
  fi
  printf '{"operation":"monitor-email-drill","active":false,"probeRestored":true,"emailDeliveryNotAssumed":true}\n'
}
if [[ "$1" = --recover ]]; then recover; exit; fi
if [[ -f "$state" ]]; then
  python3 -B - <<'PY'
import pathlib,json
v=json.loads(pathlib.Path('/var/lib/sliper-monitor/mail-drill.json').read_text())
assert v.get('active') is not True, 'DRILL_ALREADY_ACTIVE'
PY
fi
for service in sliper-web sliper-tls sliper-notifications sliper-video sliper-monitor sliper-monitor.timer; do
  systemctl is-active --quiet "$service"
done
unit="sliper-monitor-mail-recover-$(date -u +%s)"
# Install/verify the recovery timer BEFORE pausing the regular monitor probe.
systemd-run --quiet --collect --unit="$unit" --description='Automatically restore Sliper monitor after email drill' --on-active=8m --timer-property=AccuracySec=1s /bin/bash /opt/sliper/ops/sliper-monitor-email-drill.sh --recover
systemctl is-active --quiet "$unit.timer"
python3 -B - "$unit" <<'PY'
import json,pathlib,sys,time,os
p=pathlib.Path('/var/lib/sliper-monitor/mail-drill.json')
t=p.with_suffix('.tmp');t.write_text(json.dumps({'version':1,'unit':sys.argv[1],'startedAt':time.time(),'automaticRecoverySeconds':480,'active':True}));os.chmod(t,0o600);os.replace(t,p)
PY
trap 'recover; exit 1' ERR
systemctl stop sliper-monitor.timer sliper-monitor-probe.service
python3 -B - <<'PY'
import pathlib,json,time,os,stat
p=pathlib.Path('/var/lib/sliper-monitor/status.json');meta=p.lstat()
assert stat.S_ISREG(meta.st_mode) and meta.st_uid==0
v=json.loads(p.read_text());v['healthy']=False;v['checkedAt']=time.time();v['checks']['operator-email-drill']=False
t=p.with_suffix('.drill.tmp');t.write_text(json.dumps(v));os.chown(t,0,meta.st_gid);os.chmod(t,0o640);os.replace(t,p)
PY
code=$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:13002/ops/health)
[[ "$code" = 503 ]]
trap - ERR
printf '{"operation":"monitor-email-drill","active":true,"http":503,"automaticRecoverySeconds":480,"applicationServicesStopped":false,"emailDeliveryNotAssumed":true}\n'
