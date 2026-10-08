from pathlib import Path
import datetime, hashlib, json, os, subprocess

job = Path(__file__).resolve().parent
uid, gid = os.getuid(), os.getgid()
(job / 'sandbox-passwd').write_text(f'reviewer:x:{uid}:{gid}:Synthetic reviewer:/tmp:/bin/sh\n')
(job / 'sandbox-group').write_text(f'reviewer:x:{gid}:\n')
node = '/home/mickh/.nvm/versions/node/v24.19.0/bin/node'
cmd = ['bwrap', '--unshare-all', '--die-with-parent', '--ro-bind', '/usr', '/usr',
       '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
       '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
       '--ro-bind', str(job / 'sandbox-passwd'), '/etc/passwd',
       '--ro-bind', str(job / 'sandbox-group'), '/etc/group',
       '--ro-bind', node, '/runtime/node', '--ro-bind', str(job), '/evidence',
       '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C',
       '--chdir', '/tmp', '/runtime/node', '/evidence/probe.mjs']
began = datetime.datetime.now(datetime.timezone.utc).isoformat()
p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
prefix = job / f'probe-{stamp}'
prefix.with_suffix('.stdout.jsonl').write_text(p.stdout)
prefix.with_suffix('.stderr.txt').write_text(p.stderr)
record = {'began': began, 'finished': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'command': cmd, 'exit_code': p.returncode,
          'script_hashes': {f: hashlib.sha256((job / f).read_bytes()).hexdigest() for f in ['probe.mjs', 'run-probe.py']},
          'stdout': prefix.with_suffix('.stdout.jsonl').name, 'stderr': prefix.with_suffix('.stderr.txt').name}
prefix.with_suffix('.run.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
print(p.stderr)
for line in p.stdout.splitlines():
    data = json.loads(line)
    if data['kind'] != 'command': print(json.dumps(data))
    elif data['exit_code'] != 0: print(json.dumps(data))
raise SystemExit(p.returncode)
