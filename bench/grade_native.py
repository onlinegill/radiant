#!/usr/bin/env python
"""
Grade SWE-bench Lite predictions on this Mac, without Docker.

⚠️ WHY THIS EXISTS. The official evaluator runs each task in an x86_64 Docker
image. This machine is Apple silicon on a pre-release macOS with no Rosetta and
a Homebrew that refuses to build qemu against the installed Xcode — there is no
container runtime to be had here without Tony updating the toolchain the iOS
app is built with. So the tests run natively instead.

⚠️ WHAT IS OFFICIAL AND WHAT IS NOT. The test lists (FAIL_TO_PASS /
PASS_TO_PASS), the eval script, the log parsers and the grading logic are all
swebench's own, imported from the package — a "resolved" here means exactly
what it means in the paper. What differs is the ENVIRONMENT: a uv virtualenv on
macOS built from the same recipe swebench used for its images (python version,
requirements file, pinned packages, pre-install edits), rather than the image
itself. That is why every task is checked with the GOLD patch before an agent is
allowed to spend a token on it: a task whose reference fix does not resolve
natively is dropped, so the grader can never fail an agent for a reason that is
the grader's.

Only pure-Python repositories are gradable this way (django, sympy, pytest,
sphinx, requests, pylint, flask — 239 of the 300 Lite tasks). The scientific
stack (matplotlib, scikit-learn, astropy, xarray, seaborn) needs compiled old
versions and is excluded from the sample. bench-harness.mjs knows this list.

  grade_native.py --preds preds.jsonl --out report.json [--ids a,b] [--workers 2]
  grade_native.py --gold --ids a,b --out gold.json         (prove the grader)
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / 'data' / 'swe-bench-lite.json'
REPOS = HERE / 'repos'
ENVS = HERE / 'envs'
LOGS = HERE / 'logs'
BIN = HERE / 'bin'
UV = shutil.which('uv') or os.path.expanduser('~/.local/bin/uv')

sys.path.insert(0, str(HERE))
from swebench.harness.utils import make_test_spec
from swebench.harness.grading import get_eval_report
from swebench.harness.constants import APPLY_PATCH_FAIL

# swebench 5 bakes the environment recipe into its images; 4.1 still carried it
# as a table, fetched into data/ once. Same recipe, different runtime.
_ns = {}
exec((HERE / 'data' / 'swebench_specs_py.py').read_text(), _ns)
SPECS = _ns['MAP_REPO_VERSION_TO_SPECS_PY']
REQS_PATHS = _ns['MAP_REPO_TO_REQS_PATHS']

NATIVE_REPOS = ['django/django', 'sympy/sympy', 'pytest-dev/pytest', 'sphinx-doc/sphinx',
                'psf/requests', 'pylint-dev/pylint', 'pallets/flask']

# ⚠️ /usr/local/bin/git IS AN INTEL BINARY on this Mac (the old Homebrew) and
# dies with "Bad CPU type" once it is first on PATH. Apple's own tools go first.
BASE_ENV = dict(os.environ)
BASE_ENV['PATH'] = '/usr/bin:/bin:/usr/sbin:/sbin:' + os.path.expanduser('~/.local/bin') + ':' + BASE_ENV.get('PATH', '')

def sh(cmd, cwd=None, env=None, timeout=None, log=None):
    p = subprocess.run(cmd, shell=True, cwd=cwd, env=env or BASE_ENV, timeout=timeout,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if log is not None:
        log.write(f'$ {cmd}\n{p.stdout}\n')
    return p

def dataset():
    return {r['instance_id']: r for r in json.loads(DATA.read_text())}

def ensure_repo(repo):
    d = REPOS / (repo.replace('/', '__') + '.git')
    if not d.exists():
        REPOS.mkdir(exist_ok=True)
        r = sh(f'git clone -q --bare https://github.com/{repo}.git {d}')
        if r.returncode: raise RuntimeError(f'clone {repo}: {r.stdout[-400:]}')
    return d

def checkout(repo, commit, dest):
    bare = ensure_repo(repo)
    r = sh(f'git clone -q --shared --no-checkout {bare} {dest} && git -C {dest} checkout -q {commit}')
    if r.returncode:
        # the mirror may predate the commit — fetch and retry once
        sh(f'git -C {bare} fetch -q origin')
        r = sh(f'git clone -q --shared --no-checkout {bare} {dest} && git -C {dest} checkout -q {commit}')
        if r.returncode: raise RuntimeError(f'checkout {repo}@{commit}: {r.stdout[-400:]}')

def requirements_text(repo, commit):
    """The same requirements swebench installed, read from the local mirror."""
    bare = ensure_repo(repo)
    for path in REQS_PATHS.get(repo, []):
        r = sh(f'git -C {bare} show {commit}:{path}')
        if r.returncode == 0:
            break
    else:
        raise RuntimeError(f'no requirements file for {repo}@{commit}')
    exclude = lambda l: any(l.strip().startswith(x) for x in ['-e .', '#', '.[test'])
    req_dir = '/'.join(path.split('/')[:-1])
    out, extra = [], []
    for line in r.stdout.split('\n'):
        if line.strip().startswith('-r'):
            sub = line[2:].strip()
            rr = sh(f'git -C {bare} show {commit}:{(req_dir + "/" if req_dir else "") + sub}')
            if rr.returncode == 0:
                extra += [l for l in rr.stdout.split('\n') if not exclude(l)]
        elif not exclude(line):
            out.append(line)
    text = '\n'.join(extra + out)
    # yanked from PyPI; swebench substitutes it too
    text = re.sub(r'^types-pkg_resources.*$', 'types-setuptools', text, flags=re.M)
    return text

def py_version(spec):
    v = str(spec.get('python', '3.9'))
    # uv has no 3.6/3.7 builds; the spec's floor was the image's, not the code's
    return '3.8' if v in ('3.5', '3.6', '3.7') else v

def sed_shim():
    """macOS sed wants `-i ''`; the recipes were written for GNU sed."""
    BIN.mkdir(exist_ok=True)
    f = BIN / 'sed'
    if not f.exists():
        f.write_text('#!/bin/bash\nargs=()\nfor a in "$@"; do if [ "$a" = "-i" ]; then args+=("-i" ""); else args+=("$a"); fi; done\nexec /usr/bin/sed "${args[@]}"\n')
        f.chmod(0o755)
    return str(BIN)

def build_env(inst, workdir, log):
    """A fresh venv for this task, from swebench's recipe. uv caches wheels, so
    the second task on a repo is seconds, not minutes."""
    spec = SPECS[inst['repo']][inst['version']]
    venv = workdir / '.venv'
    py = py_version(spec)
    r = sh(f'{UV} venv -q --seed --python-preference only-managed --python {py} {venv}', log=log)
    if r.returncode: raise RuntimeError(f'uv venv py{py}: {r.stdout[-300:]}')
    pip = f'{UV} pip install -q --python {venv}/bin/python'
    # conda envs carry setuptools (pkg_resources) and wheel; a uv venv does not,
    # and sphinx's test fixtures import pkg_resources at collection time
    sh(f"{pip} 'setuptools<70' wheel", log=log)
    pkgs = spec.get('packages', '')
    if pkgs == 'requirements.txt':
        reqs = workdir / 'swebench-requirements.txt'
        reqs.write_text(requirements_text(inst['repo'], inst['environment_setup_commit']))
        r = sh(f'{pip} -r {reqs}', log=log, timeout=900)
        if r.returncode: raise RuntimeError(f'requirements: {r.stdout[-500:]}')
    elif pkgs:
        r = sh(f'{pip} {pkgs}', log=log, timeout=600)
        if r.returncode: raise RuntimeError(f'packages {pkgs}: {r.stdout[-400:]}')
    # ⚠️ UNPINNED DEPENDENCIES DRIFT. swebench's images were built in 2024 and
    # froze whatever pip resolved then; a fresh resolve today pulls docutils
    # 0.23, which dropped the module Sphinx 3/4 imports. Pins are the 2024
    # resolution, and are recorded here so the environment stays reproducible.
    if inst['repo'] == 'sphinx-doc/sphinx':
        sh(f"{pip} 'docutils<0.21' 'alabaster<0.7.14'", log=log)
    if spec.get('pip_packages'):
        r = sh(f'{pip} ' + ' '.join(f"'{p}'" for p in spec['pip_packages']), log=log, timeout=600)
        if r.returncode: raise RuntimeError(f'pip_packages: {r.stdout[-400:]}')
    # pytest/sympy/django logs all go through pytest-style or their own runner;
    # a couple of recipes assume pytest is present without saying so
    sh(f'{pip} pytest', log=log)
    # ⚠️ PYTHON 3.6 HID DOCSTRINGS THAT START WITH A NEWLINE. Its
    # TestCase.shortDescription() was `doc.split("\n")[0]` — an empty first
    # line meant no description, so `test_x (Cls) ... ok` stayed on ONE line.
    # 3.8 strips first, prints the docstring on a second line, and swebench's
    # django parser then records the docstring instead of the test name — six
    # PASS_TO_PASS tests "failed" under the GOLD patch. The official lists were
    # generated under 3.6, so a 3.6-spec task gets 3.6's behaviour back.
    if str(spec.get('python')) in ('3.5', '3.6', '3.7'):
        site = venv / 'lib' / f'python{py}' / 'site-packages' / 'sitecustomize.py'
        site.write_text('import unittest\n'
                        'def _short(self):\n'
                        '    doc = self._testMethodDoc\n'
                        '    return doc and doc.split("\\n")[0].strip() or None\n'
                        'unittest.TestCase.shortDescription = _short\n')
    return venv

def env_for(venv):
    env = dict(BASE_ENV)
    env['PATH'] = f'{venv}/bin:{sed_shim()}:' + env['PATH']
    env['VIRTUAL_ENV'] = str(venv)
    env['LANG'] = env['LC_ALL'] = 'en_US.UTF-8'
    env.pop('PYTHONPATH', None)
    # ⚠️ macOS's $TMPDIR lives under /var, which is a symlink to /private/var.
    # pytest's own test-suite compares paths it created with paths it
    # resolved, and the two differ by that prefix — tests that pass in the
    # Linux image fail here for no reason of the patch's. A real directory.
    tmp = HERE / 'tmp'; tmp.mkdir(exist_ok=True)
    env['TMPDIR'] = str(tmp)
    return env

def install(inst, workdir, venv, log):
    spec = SPECS[inst['repo']][inst['version']]
    env = env_for(venv)
    for cmd in spec.get('pre_install') or []:
        sh(cmd, cwd=workdir, env=env, log=log)
    if spec.get('install'):
        r = sh(spec['install'], cwd=workdir, env=env, log=log, timeout=900)
        if r.returncode: raise RuntimeError(f'install: {r.stdout[-500:]}')

def apply_patch(workdir, patch, log):
    """git apply, then GNU patch with fuzz — the same ladder the container uses."""
    pf = workdir / 'model.patch'
    pf.write_text(patch if patch.endswith('\n') else patch + '\n')
    for cmd in (f'git apply -v {pf}', f'git apply -v --3way {pf}', f'patch --batch --fuzz=5 -p1 -i {pf}'):
        r = sh(cmd, cwd=workdir, log=log)
        if r.returncode == 0: return True
        sh('git checkout -q -- . && git clean -qfd -e model.patch -e .venv -e swebench-requirements.txt', cwd=workdir)
    log.write(f'{APPLY_PATCH_FAIL}\n')
    return False

def native_eval_script(inst, workdir, venv):
    """The dataset's own eval script, re-pointed at this venv and folder."""
    out = []
    for line in inst['eval_script'].split('\n'):
        if line in ('#!/bin/bash', 'set -uxo pipefail'): continue
        if 'locale-gen' in line or 'safe.directory' in line: continue
        if line.startswith('source /opt/miniconda3/bin/activate'): line = f'source {venv}/bin/activate'
        if line.startswith('conda activate'): line = ':'
        line = line.replace('/testbed', str(workdir))
        # ⚠️ tox --current-env symlinks .tox/py39/bin/python to the venv's
        # python, and a python launched through a symlink outside the venv
        # does not find the venv's pyvenv.cfg — so it starts with no pytest.
        # The container's conda env has no pyvenv.cfg to lose. tox's only job
        # here is to run this exact command (see its own -v output), so run it.
        if line.startswith('tox --current-env -epy39 -v -- '):
            line = 'python -X dev -m pytest -rA --durations 25 ' + line[len('tox --current-env -epy39 -v -- '):]
        out.append(line)
    from swebench.harness.utils import record_test_exit_code
    return 'set -uxo pipefail\n' + '\n'.join(record_test_exit_code(out)) + '\n'

def grade_one(inst, prediction, keep=False, timeout=1800):
    iid = inst['instance_id']
    LOGS.mkdir(exist_ok=True)
    tag = re.sub(r'[^\w.-]', '_', prediction.get('model_name_or_path', 'model'))
    log_path = LOGS / f'{iid}.{tag}.log'
    t0 = time.time()
    workdir = Path(tempfile.mkdtemp(prefix=f'{iid}-', dir=HERE / 'work'))
    with open(log_path, 'w') as log:
        try:
            checkout(inst['repo'], inst['base_commit'], workdir)
            venv = build_env(inst, workdir, log)
            install(inst, workdir, venv, log)
            if prediction.get('model_patch') and apply_patch(workdir, prediction['model_patch'], log):
                script = workdir / 'eval.sh'
                script.write_text(native_eval_script(inst, workdir, venv))
                try:
                    r = subprocess.run(['bash', str(script)], cwd=workdir, env=env_for(venv), timeout=timeout,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                    log.write(r.stdout)
                except subprocess.TimeoutExpired as e:
                    log.write((e.stdout or '') + '\n>>>>> Tests Timed Out\n')
        except Exception as e:
            log.write(f'\n>>>>> Tests Errored\n{type(e).__name__}: {e}\n')
    spec = make_test_spec(inst)
    report = get_eval_report(spec, prediction, str(log_path), include_tests_status=True)[iid]
    report['seconds'] = round(time.time() - t0, 1)
    report['log'] = str(log_path)
    if not keep: shutil.rmtree(workdir, ignore_errors=True)
    return report

def prepare(iid, dest):
    """A working copy an AGENT can use: the repo at base_commit with a venv
    holding its dependencies, installed — the same recipe the grader builds, so
    the agent can run the project's tests the way the paper's containers let
    it. .venv is excluded from git so it never lands in the patch."""
    inst = dataset()[iid]
    dest = Path(dest).resolve()
    if dest.exists(): shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(str(dest) + '.prepare.log', 'w') as log:
        checkout(inst['repo'], inst['base_commit'], dest)
        venv = build_env(inst, dest, log)
        install(inst, dest, venv, log)
    with open(dest / '.git' / 'info' / 'exclude', 'a') as f:
        f.write('.venv\nswebench-requirements.txt\n__pycache__/\n*.pyc\n')
    print(json.dumps({'workdir': str(dest), 'venv': str(venv), 'python': py_version(SPECS[inst['repo']][inst['version']])}))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prepare', nargs=2, metavar=('INSTANCE_ID', 'DEST'), help='check out + build the env for an agent to work in')
    ap.add_argument('--preds', help='jsonl of {instance_id, model_name_or_path, model_patch}')
    ap.add_argument('--gold', action='store_true', help='grade the dataset\'s own fix, to prove the grader')
    ap.add_argument('--ids', help='comma-separated instance ids')
    ap.add_argument('--out')
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--keep', action='store_true')
    a = ap.parse_args()
    if a.prepare:
        return prepare(*a.prepare)
    ds = dataset()
    (HERE / 'work').mkdir(exist_ok=True)
    if a.gold:
        ids = a.ids.split(',')
        preds = [{'instance_id': i, 'model_name_or_path': 'gold', 'model_patch': ds[i]['patch']} for i in ids]
    else:
        preds = [json.loads(l) for l in open(a.preds) if l.strip()]
        if a.ids: preds = [p for p in preds if p['instance_id'] in set(a.ids.split(','))]
    import hashlib
    sha = lambda p: hashlib.sha1((p.get('model_patch') or '').encode()).hexdigest()[:12]
    bysha = {p['instance_id']: sha(p) for p in preds}
    results = {}
    if Path(a.out).exists():
        results = json.loads(Path(a.out).read_text())
        # ⚠️ A GRADE BELONGS TO A PATCH, NOT TO A TASK ID. Attempts get redone
        # (a subscription cap, a server that never answered) and the redo has a
        # different patch; a resume keyed on the id alone kept the stale grade
        # and reported 0/30 for a run that had in fact been rerun. Re-grade
        # whenever the patch is not the one that was graded.
        preds = [p for p in preds if results.get(p['instance_id'], {}).get('patch_sha') != sha(p)]
        print(f'{len(results)} graded before, {len(preds)} new or changed')
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = {ex.submit(grade_one, ds[p['instance_id']], p, a.keep): p['instance_id'] for p in preds}
        for f in as_completed(futs):
            iid = futs[f]
            try: rep = f.result()
            except Exception as e: rep = {'resolved': False, 'error': str(e)}
            rep['patch_sha'] = bysha[iid]
            results[iid] = rep
            print(f"  {iid:32} {'RESOLVED' if rep.get('resolved') else 'no':8} {rep.get('seconds','?')}s"
                  + ('' if rep.get('patch_successfully_applied', True) else '  (patch did not apply)')
                  + (f"  {rep.get('infra_failure_reason')}" if rep.get('infra_failure_reason') else ''), flush=True)
            Path(a.out).write_text(json.dumps(results, indent=1))
    n = len(results); ok = sum(1 for r in results.values() if r.get('resolved'))
    print(f'\n{ok}/{n} resolved → {a.out}')

if __name__ == '__main__':
    main()
