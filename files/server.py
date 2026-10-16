#!/usr/bin/env python3
"""HealthConnect database server (no dependencies: Python 3.9+ standard library only).

Run:   python3 server.py
Open:  http://127.0.0.1:8000/          (the app)
       http://127.0.0.1:8000/admin     (database manager; needs the admin token)

Data lives in healthconnect.db (SQLite) next to this file.
"""
import json, os, re, secrets, sqlite3, sys, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("HC_DB", ROOT / "healthconnect.db"))
HOST = os.environ.get("HC_HOST", "127.0.0.1")
PORT = int(os.environ.get("HC_PORT", "8000"))
MAX_BODY = 2 * 1024 * 1024
STATIC_OK = {".html", ".css", ".js"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+$")

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','doctor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT,
  seeded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  req_id TEXT, name TEXT, initials TEXT, facility TEXT, detail TEXT,
  when_text TEXT, status TEXT, tone TEXT
);
CREATE TABLE IF NOT EXISTS approved_doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT, name TEXT, initials TEXT, access TEXT, last_access TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS rejected_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  req_id TEXT, name TEXT, initials TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor TEXT, "date" TEXT, day TEXT, month TEXT, specialty TEXT,
  "time" TEXT, "type" TEXT, initials TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT, file_name TEXT, "date" TEXT, "type" TEXT, category TEXT
);
"""

# dashboard state key -> (table, [(js field, column)])
STATE_MAP = {
    "requests": ("access_requests", [("id", "req_id"), ("name", "name"), ("initials", "initials"), ("facility", "facility"), ("detail", "detail"), ("when", "when_text"), ("status", "status"), ("tone", "tone")]),
    "approved": ("approved_doctors", [("id", "doc_id"), ("name", "name"), ("initials", "initials"), ("access", "access"), ("lastAccess", "last_access"), ("status", "status")]),
    "rejected": ("rejected_requests", [("id", "req_id"), ("name", "name"), ("initials", "initials")]),
    "appointments": ("appointments", [("doctor", "doctor"), ("date", "date"), ("day", "day"), ("month", "month"), ("specialty", "specialty"), ("time", "time"), ("type", "type"), ("initials", "initials")]),
    "reports": ("reports", [("name", "name"), ("fileName", "file_name"), ("date", "date"), ("type", "type"), ("category", "category")]),
}


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def load_admin_token():
    env = os.environ.get("HC_ADMIN_TOKEN")
    if env:
        return env
    f = ROOT / ".admin-token"
    if f.exists():
        return f.read_text().strip()
    token = secrets.token_urlsafe(18)
    f.write_text(token)
    try:
        f.chmod(0o600)
    except OSError:
        pass
    return token


ADMIN_TOKEN = None


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def clean(value, limit=500):
    if value is None:
        return None
    return str(value)[:limit]


def read_state(conn, user_id):
    state = {}
    for key, (table, fields) in STATE_MAP.items():
        cols = ", ".join(f'"{c}"' for _, c in fields)
        rows = conn.execute(f'SELECT {cols} FROM "{table}" WHERE user_id = ? ORDER BY id', (user_id,)).fetchall()
        state[key] = [{js: r[col] for js, col in fields} for r in rows]
    return state


def write_state(conn, user_id, state):
    with conn:
        for key, (table, fields) in STATE_MAP.items():
            items = state.get(key, [])
            if not isinstance(items, list):
                raise ApiError(400, f"'{key}' must be a list")
            conn.execute(f'DELETE FROM "{table}" WHERE user_id = ?', (user_id,))
            cols = ", ".join(f'"{c}"' for _, c in fields)
            marks = ", ".join("?" for _ in fields)
            for item in items[:1000]:
                if not isinstance(item, dict):
                    continue
                conn.execute(
                    f'INSERT INTO "{table}" (user_id, {cols}) VALUES (?, {marks})',
                    (user_id, *[clean(item.get(js)) for js, _ in fields]),
                )
        conn.execute("UPDATE users SET seeded = 1 WHERE id = ?", (user_id,))


def table_names(conn):
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
    return [r["name"] for r in rows]


def table_columns(conn, table):
    if table not in table_names(conn):
        raise ApiError(404, "Unknown table")
    return [dict(r) for r in conn.execute(f'PRAGMA table_info("{table}")')]


class Handler(BaseHTTPRequestHandler):
    server_version = "HealthConnectDB/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---------- helpers ----------
    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Request too large")
        if not length:
            return {}
        try:
            data = json.loads(self.rfile.read(length))
        except ValueError:
            raise ApiError(400, "Invalid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "JSON object expected")
        return data

    def session_user(self, conn):
        header = self.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", (token,)
        ).fetchone() if token else None
        if not row:
            raise ApiError(401, "Please sign in again")
        return row

    def require_admin(self):
        supplied = self.headers.get("X-Admin-Token", "")
        if not secrets.compare_digest(supplied.encode(), ADMIN_TOKEN.encode()):
            raise ApiError(401, "Invalid admin token")

    # ---------- dispatch ----------
    def handle_any(self, method):
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path.startswith("/api/"):
                self.api(method, url.path, query)
            elif method == "GET":
                self.static(url.path)
            else:
                raise ApiError(405, "Method not allowed")
        except ApiError as e:
            self.send_json(e.status, {"error": e.message})
        except sqlite3.Error as e:
            self.send_json(400, {"error": f"Database error: {e}"})
        except Exception as e:  # noqa
            sys.stderr.write(f"Unhandled error: {e!r}\n")
            self.send_json(500, {"error": "Server error"})

    do_GET = lambda self: self.handle_any("GET")
    do_POST = lambda self: self.handle_any("POST")
    do_PUT = lambda self: self.handle_any("PUT")
    do_DELETE = lambda self: self.handle_any("DELETE")

    def static(self, path):
        name = {"/": "index.html", "/admin": "admin.html"}.get(path, path.lstrip("/"))
        f = ROOT / name
        if "/" in name or name.startswith(".") or f.suffix not in STATIC_OK or not f.is_file():
            raise ApiError(404, "Not found")
        ctype = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}[f.suffix]
        self.send_bytes(200, f.read_bytes(), ctype + "; charset=utf-8", {"Cache-Control": "no-cache"})

    def api(self, method, path, q):
        # ----- user-facing -----
        if path == "/api/login" and method == "POST":
            d = self.read_json()
            email = str(d.get("email", "")).strip()[:254]
            if not EMAIL_RE.match(email):
                raise ApiError(400, "A valid email is required")
            name = (str(d.get("name", "")).strip() or email.split("@")[0])[:120]
            role = d.get("role") if d.get("role") in ("patient", "doctor") else "patient"
            conn = connect()
            try:
                with conn:
                    # Existing accounts keep their saved name and role.
                    conn.execute("INSERT OR IGNORE INTO users (email, name, role) VALUES (?, ?, ?)", (email, name, role))
                    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
                    token = secrets.token_urlsafe(32)
                    conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user["id"]))
                    conn.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user["id"],))
            finally:
                conn.close()
            return self.send_json(200, {"token": token, "user": {"name": user["name"], "email": user["email"], "role": user["role"]}})

        if path == "/api/logout" and method == "POST":
            conn = connect()
            try:
                user = self.session_user(conn)
                with conn:
                    conn.execute("DELETE FROM sessions WHERE token = ?", (self.headers["Authorization"][7:],))
            finally:
                conn.close()
            return self.send_json(200, {"ok": True})

        if path == "/api/state" and method in ("GET", "PUT"):
            conn = connect()
            try:
                user = self.session_user(conn)
                if method == "GET":
                    state = read_state(conn, user["id"]) if user["seeded"] else None
                    return self.send_json(200, {"state": state})
                d = self.read_json()
                write_state(conn, user["id"], d.get("state") or {})
                return self.send_json(200, {"ok": True})
            finally:
                conn.close()

        # ----- admin -----
        if path.startswith("/api/admin/"):
            self.require_admin()
            return self.admin(method, path[len("/api/admin/"):], q)

        raise ApiError(404, "Not found")

    def admin(self, method, route, q):
        conn = connect()
        try:
            if route == "tables" and method == "GET":
                out = []
                for t in table_names(conn):
                    n = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                    out.append({"name": t, "count": n})
                return self.send_json(200, {"tables": out, "db_file": DB_PATH.name})

            if route == "rows" and method == "GET":
                t = q.get("table", "")
                cols = table_columns(conn, t)
                limit = max(1, min(int(q.get("limit", 25)), 200))
                offset = max(0, int(q.get("offset", 0)))
                where, params = "", []
                if q.get("q"):
                    where = " WHERE " + " OR ".join(f'CAST("{c["name"]}" AS TEXT) LIKE ?' for c in cols)
                    params = [f"%{q['q']}%"] * len(cols)
                total = conn.execute(f'SELECT COUNT(*) FROM "{t}"{where}', params).fetchone()[0]
                rows = conn.execute(f'SELECT rowid AS "_rowid_", * FROM "{t}"{where} ORDER BY rowid LIMIT ? OFFSET ?', [*params, limit, offset]).fetchall()
                return self.send_json(200, {"columns": cols, "rows": [dict(r) for r in rows], "total": total})

            if route == "rows" and method in ("POST", "PUT"):
                d = self.read_json()
                t = d.get("table", "")
                valid = {c["name"] for c in table_columns(conn, t)}
                values = {k: (None if v == "" else v) for k, v in (d.get("values") or {}).items() if k in valid and k != "id"}
                with conn:
                    if method == "POST":
                        if not values:
                            raise ApiError(400, "No values supplied")
                        cols = ", ".join(f'"{k}"' for k in values)
                        conn.execute(f'INSERT INTO "{t}" ({cols}) VALUES ({", ".join("?" for _ in values)})', list(values.values()))
                    else:
                        if not values:
                            raise ApiError(400, "No values supplied")
                        sets = ", ".join(f'"{k}" = ?' for k in values)
                        cur = conn.execute(f'UPDATE "{t}" SET {sets} WHERE rowid = ?', [*values.values(), int(d.get("rowid"))])
                        if cur.rowcount == 0:
                            raise ApiError(404, "Row not found")
                return self.send_json(200, {"ok": True})

            if route == "rows" and method == "DELETE":
                t = q.get("table", "")
                table_columns(conn, t)
                with conn:
                    conn.execute(f'DELETE FROM "{t}" WHERE rowid = ?', (int(q.get("rowid", 0)),))
                return self.send_json(200, {"ok": True})

            if route == "csv" and method == "GET":
                import csv, io
                t = q.get("table", "")
                cols = [c["name"] for c in table_columns(conn, t)]
                buf = io.StringIO()
                w = csv.writer(buf)
                w.writerow(cols)
                for r in conn.execute(f'SELECT * FROM "{t}" ORDER BY rowid'):
                    w.writerow([r[c] for c in cols])
                return self.send_bytes(200, buf.getvalue().encode(), "text/csv; charset=utf-8", {"Content-Disposition": f'attachment; filename="{t}.csv"'})

            if route == "export" and method == "GET":
                with tempfile.TemporaryDirectory() as tmp:
                    dest_path = Path(tmp) / "backup.db"
                    dest = sqlite3.connect(dest_path)
                    conn.backup(dest)
                    dest.close()
                    data = dest_path.read_bytes()
                return self.send_bytes(200, data, "application/octet-stream", {"Content-Disposition": 'attachment; filename="healthconnect-backup.db"'})

            if route == "sql" and method == "POST":
                # Read-only query console.
                sql = str(self.read_json().get("sql", "")).strip().rstrip(";")
                if not re.match(r"(?is)^(select|with|pragma\s+table_info)\b", sql) or ";" in sql:
                    raise ApiError(400, "Only a single SELECT query is allowed here")
                conn.execute("PRAGMA query_only = ON")
                cur = conn.execute(sql)
                cols = [d[0] for d in cur.description or []]
                rows = [list(r) for r in cur.fetchmany(500)]
                return self.send_json(200, {"columns": cols, "rows": rows})

            raise ApiError(404, "Not found")
        finally:
            conn.close()


def main():
    global ADMIN_TOKEN
    conn = connect()
    conn.executescript(SCHEMA)
    conn.close()
    ADMIN_TOKEN = load_admin_token()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"HealthConnect running at http://{HOST}:{PORT}/")
    print(f"Database manager:        http://{HOST}:{PORT}/admin")
    print(f"Admin token:             {ADMIN_TOKEN}   (also saved in .admin-token)")
    print(f"Database file:           {DB_PATH}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
