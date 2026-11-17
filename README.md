# Daylo

A shift calendar for rotating work schedules, installable on the phone as a web app (PWA). Spanish interface.

- **Semana:** the seven days of the week, each with its shift, times, and whether it's an office day (and by car or bus). The next day off is shown under the week.
- **Mes:** the month as a grid, each day filled with its shift's colour, plus a count of each shift type and of office days.
- **Oficina:** the next office day and a packing list (search or add in one field, tick items off, untick all for the next day).
- **Ajustes:** the times of each shift type, paste the monthly roster, calendar subscription, light/dark/system appearance, account, credits, and deleting a month.

Shift types: Temprano, Intermedio, Tarde, Formación, Libre and Festivo. Times are editable.

## Pasting the roster

Rosters arrive as plain text, one day after another, for example:

```
Support
15:00-00:00
23:00-08:00
DAY OFF
PUBLIC HOLIDAY
Support 11:30-20:30 (19:00-04:00)
```

`Support` / `Onboarding` start a working day; the first time range after them is used and any other range (or one in brackets) is ignored. `DAY OFF` and `PUBLIC HOLIDAY` are one day each, and headings such as `1st Dec:` are skipped. A time range that matches a shift type gets that type; any other range is kept as its own shift. A roster shorter than the month can start on any day.

## Calendar subscription

Turning on "Ver turnos en Calendario" creates a private link (`/cal/<token>.ics`) that phone calendars can subscribe to. Work days are timed events in `Atlantic/Canary` time; days off and holidays are all-day events. Turning it off deletes the link.

## How it works

- **Server:** Node.js 24, no external dependencies. Data in SQLite (`node:sqlite`).
- **Sign-in:** delegated to a separate accounts service over HTTP (`/v1/login`, `/v1/signup`, `/v1/verify`, `/v1/logout`, authenticated with a shared service token). Each user only ever sees their own data.
- **Writes:** applied on screen at once and sent in order; if the connection drops they wait and are retried. A pasted or deleted month is one all-or-nothing batch.
- **Security:** strict Content-Security-Policy (only the app's own files), session cookie (HttpOnly, SameSite), and a custom header required on every write.

## Run

```sh
npm test                      # server, roster and calendar tests
ACCOUNTS_URL=http://127.0.0.1:4600 ACCOUNTS_SERVICE_TOKEN=... COOKIE_SECURE=false npm start
```

With Docker: every push to `main` runs the tests and publishes the image to `ghcr.io/<owner>/daylo` (`.github/workflows/deploy.yml`). On the server, put `ACCOUNTS_SERVICE_TOKEN=...` in a `.env` next to `docker-compose.yml`, create `./data` owned by uid 1000, then run `docker compose pull && docker compose up -d`. To build locally instead: `docker build -t daylo .`.

`public/index.html` is generated from `tools/index.src.html` plus the inline icon sprite; edit the source and regenerate rather than editing the page by hand.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `1115` | HTTP port |
| `DATA_DIR` | `./data` | Database |
| `ACCOUNTS_URL` | `http://127.0.0.1:4600` | Accounts service |
| `ACCOUNTS_SERVICE_TOKEN` | (required) | Shared token for the accounts service |
| `COOKIE_SECURE` | `true` | Set `false` only for plain-HTTP local testing |

## Credits

Icons: [Phosphor Icons](https://phosphoricons.com) (MIT). Typeface: [Inter](https://rsms.me/inter/) (SIL Open Font License 1.1).
