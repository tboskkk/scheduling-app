# Schedule+

Staff scheduling for businesses with more than one location. Built with React and Supabase as a portfolio project; it has not been trialled with real businesses yet.

Live demo: link coming soon

## What it does

- Multi-location scheduling: build weekly schedules per location, assign shifts to employees and roles, and publish when ready.
- Coverage rules engine: set how many people each role needs per location. The engine flags gaps, overtime and rest-period conflicts, and suggests fixes.
- Employee portal: employees see their own schedule, set availability, request time off and propose shift trades.
- PDF schedules: export a weekly schedule as a printable PDF.
- Multi-tenant security: Postgres row-level security keeps organizations apart and limits what each role (manager or employee) can read and write.

## Tech stack

- React 19, TypeScript, Vite
- Tailwind CSS, React Router, TanStack Query, Zustand
- Supabase (Postgres, Auth, row-level security)
- @react-pdf/renderer for PDF output
- Vitest and Testing Library for tests
- Deployed on Cloudflare Pages

## Try the demo

The login page has two buttons when demo mode is on:

- Try as manager: opens a fictional two-location restaurant with staff, coverage rules, a published week, a draft week with a coverage gap, and pending requests.
- Try as employee: opens the employee portal for one of the demo staff.

No account is needed. Changes you make are wiped by a nightly reset.

Live demo: link coming soon

## Local setup

Requires [bun](https://bun.sh).

```
bun install
cp .env.example .env
bun run dev
```

Fill in `.env` using the keys in `.env.example`:

- `VITE_SUPABASE_PROJECT_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`: from your Supabase project settings.
- `VITE_APP_ENVIRONMENT`, `VITE_ENABLE_ANALYTICS`, `VITE_ALLOWED_EMAIL_DOMAINS`: app behaviour; the defaults are fine for development.
- `SUPABASE_SECRET_KEY`: used only by the integration tests, never shipped to the client.
- `VITE_DEMO_*`: optional, see below.

Other commands: `bun run build`, `bun run lint`, `bunx vitest run`. The integration tests need `SUPABASE_SECRET_KEY` and will not load without it.

## Database

SQL migrations live in `supabase/migrations/`, numbered in the order to apply them (schema, employee portal, security fixes, and the demo seed). Apply them to your Supabase project, for example by pasting each into the SQL Editor.

## How demo mode works

- Flags: `VITE_DEMO_MODE=true` turns it on. `VITE_DEMO_MANAGER_EMAIL`, `VITE_DEMO_EMPLOYEE_EMAIL` and `VITE_DEMO_PASSWORD` set the two demo accounts. These ship in the client bundle, so the accounts only have access to the demo organization. With the flag unset, the app behaves normally.
- Demo organization: `supabase/migrations/0007_demo_mode.sql` creates "Northwind Kitchen", a fictional restaurant with two locations, fictional staff and `example.com` addresses.
- Nightly reset: a pg_cron job runs `private.reset_demo()` every day at 09:00 UTC. It deletes only the demo organization's rows and reseeds them, with dates computed from the current date.
- Keep-alive: Supabase pauses free projects after about a week of no traffic. `.github/workflows/keep-alive.yml` signs in as the demo manager and makes one read request every Monday (anonymous requests are rejected by row-level security), and can be run by hand from the Actions tab. Add these GitHub repository secrets: `VITE_SUPABASE_PROJECT_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `DEMO_EMAIL` and `DEMO_PASSWORD`.
