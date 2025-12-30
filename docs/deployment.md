# Deployment Guide

## Overview

This guide details the process for deploying the Schedule App to Cloudflare Pages. The application is configured as a Single Page Application (SPA) using Vite and React.

## Prerequisites

- Cloudflare Account
- GitHub Repository connected to Cloudflare
- Supabase Project (Production)

## Environment Variables

The following environment variables must be configured in the Cloudflare Pages project settings:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `VITE_SUPABASE_PROJECT_URL` | The URL of your production Supabase project | Yes | `https://xyz.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The anonymous public key for Supabase | Yes | `eyJ...` |
| `VITE_APP_ENVIRONMENT` | The environment name | Yes | `production` |
| `VITE_ENABLE_ANALYTICS` | Enable analytics logging | No | `true` |
| `VITE_ALLOWED_EMAIL_DOMAINS` | Comma-separated list of allowed email domains for registration | No | `example.com,org.com` |

**Security Note:** Never commit `.env.production` or `.env.local` files containing secrets to the repository.

## Deployment Steps

### 1. Connect to Cloudflare Pages (Recommended)

Since you are using the direct GitHub integration, Cloudflare will automatically build and deploy your application whenever you push to the `main` branch.

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Go to **Workers & Pages** > **Create Application** > **Pages** > **Connect to Git**.
3. Select your GitHub repository (`schedule-app`).
4. Configure the build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Add the environment variables listed above in the **Environment variables** section.
6. Click **Save and Deploy**.

### 2. Continuous Integration (CI)

We have retained a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every Pull Request and Push to `main`. This ensures code quality by running:
- Unit Tests (`npm test`)
- Linting (`npm run lint`)
- Type Checking (`tsc`)
- Security Audits (`npm audit`)

This CI pipeline acts as a quality gate. If these checks fail, you should fix them before merging, as the Cloudflare build would likely fail or deploy broken code.

## Security Configuration

### Security Headers

The application includes a `_headers` file in the `public` directory (which is copied to `dist`) to configure HTTP security headers:

- **Content-Security-Policy (CSP):** Restricts sources for scripts, styles, images, and connections.
- **X-Frame-Options:** DENY (prevents clickjacking).
- **X-Content-Type-Options:** nosniff.
- **Referrer-Policy:** strict-origin-when-cross-origin.
- **Permissions-Policy:** Disables sensitive features like camera, microphone, geolocation.

### Access Control

- **Registration:** Restricted by `VITE_ALLOWED_EMAIL_DOMAINS` if configured.
- **Authentication:** Managed by Supabase Auth.
- **Data Access:** Secured by Supabase Row Level Security (RLS) policies.

## Troubleshooting

### Common Issues

**1. Build Fails**
- Check the build logs in Cloudflare/GitHub.
- Ensure `npm ci` succeeds.
- Verify Node.js version is 20 (configured in `.nvmrc` or workflow).

**2. White Screen / 404 on Refresh**
- Ensure the `_redirects` file is present in `public/` (for SPA routing).
- Cloudflare Pages automatically handles SPA routing if a `404.html` is present or via `_redirects`. We use `_headers` for security, but routing is handled by `index.html` fallback.
- *Note:* Ensure `vite.config.ts` is not using a base path unless configured in Cloudflare.

**3. Supabase Connection Error**
- Verify `VITE_SUPABASE_PROJECT_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are correct in Cloudflare settings.
- Check browser console for CSP violations (e.g., `Refused to connect to...`). If so, update `connect-src` in `_headers`.

## Maintenance

### Updating Dependencies

1. Run `npm outdated` to see available updates.
2. Run `npm update` to update minor versions.
3. Run `npm audit` to check for security vulnerabilities.
4. Commit `package.json` and `package-lock.json`.

### Rollback

If a deployment introduces a critical bug:
1. Go to Cloudflare Pages dashboard.
2. Select the project.
3. Go to **Deployments**.
4. Find the previous successful deployment.
5. Click **Rollback** (or redeploy that specific commit).
