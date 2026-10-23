# ForgePilot — AI App Builder Agent

ForgePilot is a Node.js app-builder starter with multiple AI provider fallback, chat-based project edits, a sandboxed preview, ZIP export, and Cloudflare Pages publishing.

## Requirements

- Node.js 18+
- At least one AI provider endpoint compatible with OpenAI's `/chat/completions` API
- Cloudflare API token with Pages Write permission for publishing

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` if you want a server-side default provider.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000`.

The dashboard also lets users enter provider names, API base URLs, model IDs, and API keys. Providers are attempted in order; when one fails, is rate-limited, or has exhausted quota, the agent tries the next configured provider. It supports OpenAI-compatible endpoints, not every vendor's proprietary API format.

## Features

- Multi-provider API configuration and fallback
- AI-generated web app projects (HTML/CSS/JS by default)
- Chat tab for iterative changes
- Preview tab for a sandboxed local HTML preview
- Files tab and ZIP export
- Cloudflare Pages publishing with a separate Pages project per generated app
- Optional custom-domain attachment when publishing

API keys entered in the dashboard are kept in browser session storage and sent to the configured backend only for generation/edit requests. They are not written into generated files or job history. The backend receives these keys, so use HTTPS and do not expose an unauthenticated backend publicly. Never commit real keys to GitHub.

## Backend environment variables

Set these on the Node.js host:

- `PORT` (optional; defaults to 3000)
- `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (optional default provider)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (keep secret; Pages Write permission)
- `CLOUDFLARE_PAGES_PROJECT_NAME` (short lowercase prefix for per-app Pages projects)
- `DEPLOYMENT_ACCESS_KEY` (long random secret required by the publish endpoint)
- `ENABLE_PROJECT_EXPORT=true` (optional)

The backend creates an app-specific Cloudflare Pages project when publishing. A supplied custom domain is attached using Cloudflare's Pages API. The domain must be managed/active in the same Cloudflare account, and DNS and certificate validation may still need attention. Cloudflare's API supports creating Pages projects and attaching custom domains. <https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/create/> <https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/>

## Important limitations

- **Cloudflare Pages hosts the static dashboard; it does not run this Node.js `server.js` API.** The backend must be deployed separately to a Node.js host for generation, chat edits, and publishing to work.
- Jobs and generated files are currently held in memory/local server storage and can be lost when the backend restarts or uses ephemeral storage. Add a durable database/object storage for real use.
- Previewing is not a secure build/test sandbox. Generated code is untrusted and is not automatically tested.
- Add login, authentication, rate limiting, quotas, persistent storage, and secure build isolation before making this a public multi-user service.
- This starter generates static web apps; it does not build Android APKs or automatically host arbitrary server-side apps.
