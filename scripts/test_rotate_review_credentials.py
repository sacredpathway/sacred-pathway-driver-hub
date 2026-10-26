#!/usr/bin/env python3
"""Offline safety test for scripts/rotate_review_credentials.sh.

Never contacts Supabase: the script is pointed at a local mock Auth server via
ROTATE_TEST_URL (the script only accepts http://127.0.0.1:<port>). Each case
runs the script in a real pseudo-terminal (like Terminal.app), types the
answers, and while it runs samples every process's argv and environment for
the test secrets. Afterwards it checks: terminal output, argv/env samples,
shell history, temp files, and exactly what the mock server received.

Run:  python3 scripts/test_rotate_review_credentials.py
"""
import base64, http.server, json, os, pty, re, select, shutil, socket, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.environ.get("SCRIPT_UNDER_TEST") or os.path.join(HERE, "rotate_review_credentials.sh")
UID = "5150a545-5962-463d-b688-3370c6b55c8e"
EMAIL = "demarquishinton+appreview@gmail.com"

def jwt(role):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b({'alg':'HS256','typ':'JWT'})}.{b({'role':role,'iss':'supabase','ref':'test'})}.c2lnbmF0dXJlLXRlc3Qtb25seQ"

SERVICE_KEY = jwt("service_role")          # fake; the mock never validates
ANON_KEY = jwt("anon")
SECRET_KEY = "sb_secret_TESTONLY" + "x9" * 16
# Password with the characters that break naive scripts: leading/trailing
# spaces, quotes, backslash, $, backtick, unicode.
PASSWORD = '  Tq"7\\$`(x) ünï–cødé PWMARK8Zr4Lq ;| '
# Plain-ASCII marker inside the password: survives JSON escaping / URL encoding,
# so a leak of the password in ANY encoding (e.g. a JSON body on curl's argv) is caught.
PW_MARK = "PWMARK8Zr4Lq"

# ---------------------------------------------------------------- mock server
class Mock(http.server.BaseHTTPRequestHandler):
    log = []
    def _rec(self, body=b""):
        Mock.log.append({"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body.decode("utf-8", "replace")})
    def do_GET(self):
        if self.path == "/auth/v1/health":
            return self._send(401, {"message": "No API key found in request"})
        self._rec()
        if self.path.endswith(UID):
            self._send(200, {"id": UID, "email": EMAIL, "updated_at": "2026-10-23T04:51:58Z"})
        else:
            self._send(404, {"code": 404, "msg": "User not found"})
    def do_PUT(self):
        n = int(self.headers.get("content-length", "0"))
        self._rec(self.rfile.read(n))
        time.sleep(1.2)  # keep curl alive so the argv/env sampler sees it
        self._send(200, {"id": UID, "email": EMAIL, "updated_at": "2026-10-25T18:30:00Z"})
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Mock)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"

# ------------------------------------------------------- process sampler
def descendants(root):
    """root and every process below it (the script, curl, python3 helpers)."""
    kids = {}
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                ppid = int(open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[1])
            except Exception:
                continue
            kids.setdefault(ppid, []).append(int(pid))
    out, todo = set(), [root]
    while todo:
        p = todo.pop(); out.add(p); todo.extend(kids.get(p, []))
    return out

def sample(stop, found, secrets, root):
    while not stop.is_set():
        r = root[0]
        for pid in (descendants(r) if r else ()):
            for part in ("cmdline", "environ"):
                try:
                    data = open(f"/proc/{pid}/{part}", "rb").read()
                except Exception:
                    continue
                for name, s in secrets.items():
                    if s.encode() in data:
                        found.add(f"{name} in /proc/{pid}/{part}")
        time.sleep(0.02)

# ------------------------------------------------------------- runner
def run(args, answers, env_extra=None, interrupt_at=None, shell_history=False, url=None, extra_secrets=None):
    tmpdir = tempfile.mkdtemp(prefix="rot-test-")
    hist = os.path.join(tmpdir, "bash_history")
    log = os.path.join(tmpdir, "rotation-status.log")
    env = {"PATH": os.environ["PATH"], "HOME": tmpdir, "TMPDIR": os.path.join(tmpdir, "t"), "LANG": "C.UTF-8",
           "ROTATE_TEST_URL": url or URL, "HISTFILE": hist, "TERM": "xterm", "ROTATE_STATUS_LOG": log}
    os.makedirs(env["TMPDIR"])
    env.update(env_extra or {})
    Mock.log.clear()
    stop, found = threading.Event(), set()
    secrets = {"password": PASSWORD.strip(), "password(any encoding)": PW_MARK, "service_key": SERVICE_KEY, "secret_key": SECRET_KEY, **(extra_secrets or {})}
    root = [None]
    th = threading.Thread(target=sample, args=(stop, found, secrets, root), daemon=True); th.start()
    if shell_history:   # interactive bash, like a user typing the command in Terminal
        argv = ["bash", "--norc", "-i"]
    else:
        argv = ["bash", SCRIPT, *args]
    pid, fd = pty.fork()
    if pid == 0:
        os.execvpe(argv[0], argv, env)
    root[0] = pid
    out = b""; queue = list(answers)
    if shell_history:
        os.write(fd, (" ".join(["bash", SCRIPT, *args]) + "\n").encode())
    deadline = time.time() + 30
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            out += chunk
        if queue and re.search(rb"(key|confirm|password)[^\n]*: $", out.split(b"\n")[-1], re.I):
            prompt = out.split(b"\n")[-1]
            if interrupt_at and interrupt_at.encode() in prompt:
                os.write(fd, b"\x03"); queue.clear(); continue
            os.write(fd, queue.pop(0).encode() + b"\r")
        if shell_history and not queue and (b"Done." in out or b"REFUSED" in out or b"nothing" in out or b"HTTP" in out):
            time.sleep(0.5); os.write(fd, b"history -a; exit\r"); shell_history = False
    try:
        os.kill(pid, 9)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
    stop.set(); th.join()
    leftovers = [os.path.join(d, f) for d, _, fs in os.walk(env["TMPDIR"]) for f in fs] + [d for d, ds, _ in os.walk(env["TMPDIR"]) if d != env["TMPDIR"]]
    history = open(hist).read() if os.path.exists(hist) else ""
    status_log = open(log, encoding="utf-8", errors="replace").read() if os.path.exists(log) else ""
    shutil.rmtree(tmpdir)
    text = out.decode("utf-8", "replace")
    leaks = [n for n, s in secrets.items() if s in text or s in history]
    log_leaks = [n for n, s in secrets.items() if s in status_log]
    return {"out": text, "requests": list(Mock.log), "argv_env": sorted(found), "leftovers": leftovers, "leaks": leaks, "history": history, "log": status_log, "log_leaks": log_leaks}

results = []
def check(name, cond, detail=""):
    results.append(cond); print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def common(name, r):
    check(f"{name}: no secret in terminal output or shell history", not r["leaks"], r["leaks"])
    check(f"{name}: no secret in any process argv/env", not r["argv_env"], r["argv_env"])
    check(f"{name}: temp files removed", not r["leftovers"], r["leftovers"])
    check(f"{name}: status log written, no secrets in it", bool(r["log"]) and not r["log_leaks"] and " END " in r["log"], (r["log_leaks"], r["log"][-300:]))
puts = lambda r: [q for q in r["requests"] if q["method"] == "PUT"]

# 1. rotate with a legacy service-role JWT; tricky password; history from an interactive shell
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, EMAIL, PASSWORD, PASSWORD], shell_history=True)
common("rotate/legacy key", r)
p = puts(r)
check("rotate: exactly one GET (identity check) then one PUT", [q["method"] for q in r["requests"]] == ["GET", "PUT"], [q["method"] for q in r["requests"]])
check("rotate: server received the password byte-for-byte (spaces, quotes, \\, $, `, unicode)", bool(p) and json.loads(p[0]["body"]) == {"password": PASSWORD})
check("rotate: legacy key sent as apikey + Bearer", bool(p) and p[0]["headers"].get("apikey") == SERVICE_KEY and p[0]["headers"].get("authorization") == f"Bearer {SERVICE_KEY}")
check("rotate: correct endpoint", bool(p) and p[0]["path"] == f"/auth/v1/admin/users/{UID}")
check("rotate: shell history holds only the command line", r["history"].strip().splitlines()[:1] == [f"bash {SCRIPT} rotate {UID} {EMAIL}"] and "history -a" in r["history"], r["history"])
check("rotate: prints HTTP 200 + non-secret fields", "HTTP 200" in r["out"] and "updated_at" in r["out"])
check("rotate: status log shows every stage ending in done", all(s in r["log"] for s in ("START", "DEPS", "NET", "KEY", "LOOKUP", "IDENTITY", "BODY", "WRITE")) and "rc=0 stage=done" in r["log"], r["log"])

# 2. new-style secret key -> apikey header only
r = run(["rotate", UID, EMAIL], [SECRET_KEY, EMAIL, PASSWORD, PASSWORD]); common("sb_secret key", r)
p = puts(r)
check("sb_secret key: apikey only, no Authorization header", bool(p) and p[0]["headers"].get("apikey") == SECRET_KEY and "authorization" not in p[0]["headers"])

# 3. anon key refused before any request
r = run(["rotate", UID, EMAIL], [ANON_KEY]); common("anon key", r)
check("anon key: refused, zero requests", not r["requests"] and "not the production service-role key (detected: anon" in r["out"])

# 4. wrong expected email -> refused after read-only GET, no PUT
r = run(["rotate", UID, "someone.else@example.com"], [SERVICE_KEY]); common("wrong email", r)
check("wrong account: REFUSED, GET only", [q["method"] for q in r["requests"]] == ["GET"] and "REFUSED" in r["out"])

# 5. unknown id -> lookup fails, no PUT
r = run(["rotate", "00000000-0000-4000-8000-000000000000", EMAIL], [SERVICE_KEY]); common("unknown id", r)
check("unknown id: lookup 404, no PUT", not puts(r) and "lookup failed: HTTP 404" in r["out"])

# 6. confirmation typed wrong -> no PUT
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, "nope@example.com"]); common("bad confirm", r)
check("confirmation mismatch: no PUT", not puts(r) and "not confirmed" in r["out"])

# 7. passwords differ / too short -> no PUT
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, EMAIL, PASSWORD, PASSWORD + "x"]); common("mismatch", r)
check("passwords differ: no PUT", not puts(r) and "passwords differ" in r["out"])
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, EMAIL, "short", "short"]); common("short", r)
check("short password: no PUT", not puts(r) and "16+" in r["out"])

# 8. dry run -> GET only
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, EMAIL, PASSWORD, PASSWORD], {"DRY_RUN": "1"}); common("dry run", r)
check("dry run: GET only, nothing sent", [q["method"] for q in r["requests"]] == ["GET"] and "Nothing sent" in r["out"])

# 9. disable / enable bodies
r = run(["disable", UID, EMAIL], [SERVICE_KEY, EMAIL]); common("disable", r)
check("disable: body is ban_duration 876000h", bool(puts(r)) and json.loads(puts(r)[0]["body"]) == {"ban_duration": "876000h"})
r = run(["enable", UID, EMAIL], [SERVICE_KEY, EMAIL]); common("enable", r)
check("enable: body is ban_duration none", bool(puts(r)) and json.loads(puts(r)[0]["body"]) == {"ban_duration": "none"})

# 10. Ctrl-C at the password prompt -> no PUT, temp files gone
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, EMAIL, PASSWORD], interrupt_at="New password"); common("ctrl-c", r)
check("Ctrl-C: no PUT", not puts(r))

# 10b. Supabase unreachable -> stops before any prompt, says why, logs stage=connectivity
dead = socket.socket(); dead.bind(("127.0.0.1", 0)); dead_port = dead.getsockname()[1]; dead.close()
r = run(["rotate", UID, EMAIL], [SERVICE_KEY], url=f"http://127.0.0.1:{dead_port}"); common("unreachable", r)
check("unreachable: no prompt, no request, clear message, logged", "Cannot reach Supabase" in r["out"] and "key" not in r["out"].split("Cannot reach")[0].lower() and not r["requests"] and "stage=connectivity" in r["log"], (r["out"][-200:], r["log"][-200:]))

# 12. key pasted with damage the script must repair (never changes a valid key)
ESC = "\x1b"
r = run(["rotate", UID, EMAIL], [f"{ESC}[200~ {SERVICE_KEY} {ESC}[201~", EMAIL, PASSWORD, PASSWORD]); common("key with paste markers+spaces", r)
p = puts(r)
check("paste markers + spaces around legacy key: cleaned, exact key sent", bool(p) and p[0]["headers"].get("apikey") == SERVICE_KEY and "cleaned_control_chars=True" in r["log"], r["log"][-300:])
r = run(["rotate", UID, EMAIL], [f'"{SECRET_KEY}"', EMAIL, PASSWORD, PASSWORD]); common("quoted sb_secret", r)
check("quoted sb_secret key: quotes removed, exact key sent", bool(puts(r)) and puts(r)[0]["headers"].get("apikey") == SECRET_KEY)

# 13. wrong credential types: refused before any request, with a precise non-secret reason
SBP = "sbp_" + "a1" * 20
JWT_SECRET = "Zq8" * 14
CUT = SERVICE_KEY.split(".")[0] + "." + SERVICE_KEY.split(".")[1][:20]
for label, key, expect in [("sbp_ access token", SBP, "personal access token"),
                           ("JWT signing secret", JWT_SECRET, "JWT signing secret"),
                           ("cut-off JWT", CUT, "cut off")]:
    r = run(["rotate", UID, EMAIL], [key], extra_secrets={"wrong_key": key}); common(label, r)
    check(f"{label}: refused, zero requests, reason shown and logged (shape only)",
          not r["requests"] and expect in r["out"] and expect in r["log"] and "len=" in r["log"], (r["out"][-200:], r["log"][-300:]))

# 14. password carrying paste markers is refused (would silently corrupt the password)
bad = f"{ESC}[200~{PASSWORD}{ESC}[201~"
r = run(["rotate", UID, EMAIL], [SERVICE_KEY, EMAIL, bad, bad]); common("password with paste markers", r)
check("password with control characters: refused, no PUT", not puts(r) and "control characters" in r["out"])

# 11. URL override cannot point anywhere but localhost
out = subprocess.run(["bash", SCRIPT, "rotate", UID, EMAIL], env={"PATH": os.environ["PATH"], "ROTATE_TEST_URL": "https://evil.example.com"}, capture_output=True, text=True, stdin=subprocess.DEVNULL)
check("non-localhost override refused", out.returncode == 2 and "must be http://127.0.0.1" in out.stderr)

srv.shutdown()
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
