#!/usr/bin/env python3
"""Sliper-only health probe and a minimal loopback status server. No credentials or member data."""
import json
import os
import stat
import subprocess
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATE = Path('/var/lib/sliper-monitor')
SNAPSHOT = STATE / 'status.json'
CERTIFICATE = Path('/var/lib/sliper-tls/certificates/certificates/acme-v02.api.letsencrypt.org-directory/211.188.59.204/211.188.59.204.crt')
UNITS = ('sliper-web', 'sliper-tls', 'sliper-notifications', 'sliper-video')
WORKERS = {'notification': ('sliper-notifications', 180), 'video': ('sliper-video', 900)}
MAX_SNAPSHOT_AGE = 120

def worker_healthy(record, kind, expected_pid, now):
    try:
        return (record['version'] == 1 and record['worker'] == kind
                and type(record['pid']) is int and record['pid'] == expected_pid and expected_pid > 0
                and type(record['startedAt']) is int and type(record['succeededAt']) is int
                and 0 < record['startedAt'] <= record['succeededAt'] <= now * 1000 + 5000
                and now * 1000 - record['succeededAt'] <= WORKERS[kind][1] * 1000
                and record['stopping'] is False)
    except (KeyError, TypeError):
        return False

def public_status(value, now):
    try:
        fresh = (value['version'] == 1 and type(value['checkedAt']) in (int, float)
                 and 0 <= now - value['checkedAt'] <= MAX_SNAPSHOT_AGE)
        good = fresh and value['healthy'] is True and value['checks'] and all(v is True for v in value['checks'].values())
        return (200, b'{"status":"ok"}\n') if good else (503, b'{"status":"unavailable"}\n')
    except (KeyError, TypeError, AttributeError):
        return 503, b'{"status":"unavailable"}\n'

def read_regular(path, maximum):
    fd = os.open(str(path), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        meta = os.fstat(stream.fileno())
        if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1 or meta.st_size > maximum:
            raise ValueError('UNSAFE_STATUS_FILE')
        contents = stream.read(maximum + 1)
        if len(contents) > maximum:
            raise ValueError('STATUS_FILE_LIMIT')
        return json.loads(contents)

def unit_state(unit):
    result = subprocess.run(['systemctl', 'show', unit, '--property=ActiveState,SubState,MainPID'],
                            capture_output=True, text=True, check=True, timeout=5)
    return dict(line.split('=', 1) for line in result.stdout.splitlines())

def collect():
    now = time.time()
    checks = {}
    units = {}
    for unit in UNITS:
        try:
            state = unit_state(unit)
            units[unit] = state
            checks[unit] = state['ActiveState'] == 'active' and state['SubState'] == 'running' and int(state['MainPID']) > 0
        except Exception:
            checks[unit] = False
    for kind, (unit, _) in WORKERS.items():
        try:
            value = read_regular(Path('/run/sliper-' + ('notifications' if kind == 'notification' else 'video')) / ('sliper-' + kind + '-health.json'), 2048)
            checks[kind + '-progress'] = worker_healthy(value, kind, int(units[unit]['MainPID']), now)
        except Exception:
            checks[kind + '-progress'] = False
    try:
        with urllib.request.urlopen('http://127.0.0.1:13001/api/health', timeout=3) as response:
            checks['web-response'] = response.status == 200 and json.loads(response.read(1024)).get('status') == 'ok'
    except Exception:
        checks['web-response'] = False
    try:
        checked = subprocess.run(['openssl', 'x509', '-in', str(CERTIFICATE), '-noout', '-checkend', '172800'],
                                 capture_output=True, check=False, timeout=5)
        checks['certificate-valid-48h'] = checked.returncode == 0
    except Exception:
        checks['certificate-valid-48h'] = False
    try:
        usage = os.statvfs('/')
        checks['disk-free-2gib'] = usage.f_bavail * usage.f_frsize >= 2 * 1024**3
    except Exception:
        checks['disk-free-2gib'] = False
    try:
        memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        checks['memory-available-256mib'] = int(memory['MemAvailable'].split()[0]) >= 256 * 1024
    except Exception:
        checks['memory-available-256mib'] = False
    return {'version': 1, 'checkedAt': now, 'healthy': all(checks.values()), 'checks': checks}

def save_snapshot(value):
    info = STATE.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('STATE_DIRECTORY_PERMISSIONS')
    temporary = STATE / ('status.' + str(os.getpid()) + '.tmp')
    fd = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, separators=(',', ':'))
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(str(temporary), 0o640)
        os.replace(str(temporary), str(SNAPSHOT))
    finally:
        if temporary.exists():
            temporary.unlink()

class Handler(BaseHTTPRequestHandler):
    server_version = 'SliperHealth'
    sys_version = ''

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.respond(False)

    def do_HEAD(self):
        self.respond(True)

    def do_POST(self):
        self.send_response(405)
        self.send_header('Allow', 'GET, HEAD')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def respond(self, head):
        if self.path.split('?', 1)[0] != '/ops/health':
            self.send_error(404)
            return
        try:
            value = read_regular(SNAPSHOT, 8192)
            code, body = public_status(value, time.time())
        except Exception:
            code, body = 503, b'{"status":"unavailable"}\n'
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('probe', 'serve'):
        raise ValueError('USAGE_PROBE_OR_SERVE')
    if sys.argv[1] == 'probe':
        if sys.platform != 'linux' or os.getuid() != 0:
            raise ValueError('ROOT_LINUX_REQUIRED')
        value = collect()
        save_snapshot(value)
        print(json.dumps({'operation': 'sliper-health-probe', 'healthy': value['healthy'], 'failedChecks': [k for k, v in value['checks'].items() if not v]}))
    else:
        if sys.platform != 'linux' or os.getuid() == 0:
            raise ValueError('UNPRIVILEGED_LINUX_REQUIRED')
        ThreadingHTTPServer(('127.0.0.1', 13002), Handler).serve_forever()

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('{"operation":"sliper-monitor","failed":true}', file=sys.stderr)
        sys.exit(1)
