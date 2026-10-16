# HealthConnect + database

## Run
    python3 server.py          # needs Python 3.9+, no installs

- App:               http://127.0.0.1:8000/
- Database manager:  http://127.0.0.1:8000/admin   (admin token is printed on start and saved in `.admin-token`)

Open the app through that address (not by double-clicking index.html), otherwise it falls back to browser-only storage.

## Data
Everything is stored in `healthconnect.db` (SQLite) next to `server.py`.
Tables: users, sessions, access_requests, approved_doctors, rejected_requests, appointments, reports (report metadata only, not file contents).
You can also open the file with any SQLite tool (DB Browser for SQLite, `sqlite3 healthconnect.db`).

## Admin page
Browse, search, add, edit and delete rows; export a table as CSV; download a full `.db` backup; run read-only SELECT queries.

## Settings (environment variables)
HC_PORT (default 8000), HC_HOST (default 127.0.0.1 = this computer only), HC_DB (database path), HC_ADMIN_TOKEN (use your own admin token).

## Important
Passwords are NOT stored or checked (prototype login unchanged: any email/password works, and an email that already exists signs in as that account).
Do not expose this to the internet or store real patient data until real authentication and HTTPS are added.
