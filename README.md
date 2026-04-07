# zenos-e2e
Standalone Playwright E2E and integration test project for Zenos.

## Purpose
This project contains all browser-driven test cases that were previously under `zenos-infra/e2e`.

It runs against sibling repositories in the same parent folder:
- `../zenos-backend`
- `../zenos-frontend`
- `../zenos-db`

## Quick Start

```bash
# from zenos-e2e root
./scripts/setup-local-dev.sh

# then install browsers/tests dependencies
cd e2e
npm install
npm run install:browsers

# run full suite
cd ..
./scripts/run-e2e.sh

# examples
./scripts/run-e2e.sh --suite smoke
./scripts/run-e2e.sh --ci 50
./scripts/run-e2e.sh --headed
./scripts/run-e2e.sh --report
```

## Bootstrap Script

Use the setup script in this project to prepare local backend/frontend env files
and optionally install dependencies/start services:

```bash
./scripts/setup-local-dev.sh
```

## Layout

```text
zenos-e2e/
├── e2e/            # Playwright config, fixtures, tests
├── scripts/        # Test runner scripts
├── test-results/   # Last-run outputs and artifacts
└── .local-dev/     # Runtime logs and PIDs (gitignored)
```

## Automated Smoke E2E (Cloudflare Worker + GitHub Actions)

This repo has a self-contained automation path for smoke E2E execution.

- Weekly trigger: Thursday 12:00 AM IST (cron in Worker as Wednesday 18:30 UTC).
- On-demand trigger: secure HTTP endpoint and dashboard on this repo's Worker.
- CI execution: GitHub Actions workflow runs `./scripts/run-e2e.sh --ci --suite smoke`.
- Report email: workflow generates an HTML summary and sends it via this Worker `/notify` endpoint.

### Files Added

- Worker code: `cloudflare/e2e-trigger-worker/src/index.ts`
- Worker config: `cloudflare/e2e-trigger-worker/wrangler.toml`
- Worker deploy pipeline: `.github/workflows/deploy-cloudflare-e2e-trigger.yml`
- Smoke run pipeline: `.github/workflows/e2e-smoke.yml`
- HTML email report generator: `scripts/ci/generate-email-report.mjs`
- Worker notifier script: `scripts/ci/notify-worker.mjs`

### 1) Required GitHub Secrets

In the `zenos-e2e` repository, configure:

- `CLOUDFLARE_API_TOKEN` (Worker deploy permission)
- `CLOUDFLARE_ACCOUNT_ID`
- `CROSS_REPO_READ_TOKEN` (read access to `zenos-frontend`, `zenos-backend`, `zenos-db`)
- `CF_E2E_WORKER_URL` (for example `https://zenos-e2e-trigger.<subdomain>.workers.dev`)
- `CF_E2E_NOTIFY_SECRET` (must match this Worker `NOTIFY_SECRET`)

Optional GitHub Variables:

- `ZENOS_REPO_OWNER` (default `zenos-work`)
- `ZENOS_FRONTEND_REPO` (default `zenos-frontend`)
- `ZENOS_BACKEND_REPO` (default `zenos-backend`)
- `ZENOS_DB_REPO` (default `zenos-db`)

### 2) Required Worker Secrets/Vars

Deploy from `cloudflare/e2e-trigger-worker` and set:

- Secret: `GITHUB_TOKEN` (GitHub PAT with Actions: write on `zenos-e2e`)
- Secret: `TRIGGER_SECRET` (for manual trigger endpoint)
- Secret: `NOTIFY_SECRET` (for `/notify` endpoint)
- Secret: `RESEND_API_KEY` (email provider API key)
- Var: `REPORT_EMAIL_TO` (target email address)
- Var: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_FILE`, `GITHUB_REF`
- Var: `EMAIL_FROM` (optional sender identity)

### 3) CI/CD Flow

1. Push Worker changes to `main` or `development`.
2. `.github/workflows/deploy-cloudflare-e2e-trigger.yml` deploys the Worker.
3. Worker cron runs every Thursday 12:00 AM IST and triggers `e2e-smoke.yml`.
4. `e2e-smoke.yml` checks out sibling repos, runs smoke E2E, uploads report artifacts.
5. Workflow builds an HTML summary and posts it to Worker `/notify`.
6. Worker sends the report email to `REPORT_EMAIL_TO`.

### 4) On-Demand Trigger Options

- Dashboard button: open Worker root URL `/`, enter `TRIGGER_SECRET`, click "Run Smoke Tests".
- API call:

```bash
curl -X POST "${CF_E2E_WORKER_URL}/trigger" \
	-H "content-type: application/json" \
	-H "x-trigger-secret: ${TRIGGER_SECRET}" \
	-d '{"reason":"manual run","suite":"smoke","source":"manual"}'
```

For production hardening, place the Worker route behind Cloudflare Access so only your team can see and use the button.

## Multi-Worker Note

`zenos-e2e` and `zenos-jobs` are intentionally independent projects. Each can keep its own `wrangler.toml`, cron triggers, and deployment workflow without conflict.
