# ForgePilot — AI App Builder Agent

A runnable Node.js starter that uses an OpenAI-compatible chat-completions endpoint (for example, your own OmniRoute instance) to generate small web projects and export them as ZIP files.

## Requirements

- Node.js 18 or newer
- An API-compatible AI endpoint you are authorized to use
- An API key and a supported model ID

## Run locally

1. Extract this ZIP.
2. Install Node.js if needed: https://nodejs.org/
3. Copy `.env.example` to `.env`.
4. Edit `.env` and enter your API configuration:
   - `AI_BASE_URL`: base URL ending in `/v1`, for example `http://127.0.0.1:20128/v1`
   - `AI_API_KEY`: your own valid key for the endpoint
   - `AI_MODEL`: model ID supported by that endpoint
5. Install dependencies:
   ```bash
   npm install
   ```
6. Start the server:
   ```bash
   npm start
   ```
7. Open http://localhost:3000

For a remote OmniRoute server, use its reachable URL instead of `127.0.0.1`. Do not expose an unauthenticated API server to the public internet. Use HTTPS and add authentication before public deployment.

## Deploy to a Node.js host

- Push the project to a private GitHub repository.
- Create a Node.js web service on your hosting provider.
- Build/install command: `npm install`
- Start command: `npm start`
- Add `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT_NAME`, `DEPLOYMENT_ACCESS_KEY`, and optionally `ENABLE_PROJECT_EXPORT` as host environment variables.
- Use `/api/health` as the health-check path if supported.

## Features

- Responsive web dashboard
- AI project generation via OpenAI-compatible `/chat/completions`
- Job status and recent activity (in-memory)
- Generated HTML/CSS/JS files saved on the server
- Project ZIP export
- Cloudflare Pages Direct Upload integration with a generated manifest and asset upload
- Basic prompt and file-path validation
- Health endpoint reporting whether AI configuration is present

## Important limitations

- This is a starter, not a fully autonomous production app factory.
- It generates simple web projects, primarily HTML/CSS/JavaScript. It does not run generated code in a secure build sandbox, build Android APKs, deploy generated apps, or guarantee generated code is correct.
- Job history is stored in memory and is lost on server restart. Generated files may be lost on hosts with ephemeral storage. Add a database/object storage for persistence.
- The preview uses a sandboxed iframe, but generated project code is still untrusted.
- Add login/authentication, rate limiting, durable storage, and request quotas before public deployment.
- Keep API keys on the server and never commit `.env` to GitHub.
- API compatibility varies; choose a model that supports chat completions and sufficient output length.

## Cloudflare Pages deployment setup

The Deploy to Cloudflare Pages action uses the Pages Direct Upload API. The target Pages project must already exist and must be a Direct Upload project. Create a Cloudflare API token with Pages Write permission, then set these server-side environment variables:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: API token with Pages Write permission. Never put this value in browser code or commit it.
- `CLOUDFLARE_PAGES_PROJECT_NAME`: the existing Pages project slug (lowercase letters, digits, hyphens).
- `DEPLOYMENT_ACCESS_KEY`: a separate long random secret that authorizes calls to this app's deploy endpoint. Enter this key in the UI when deploying.

The backend calculates 32-character SHA-256 asset hashes, uploads assets to the Pages asset store, and submits the JSON-encoded `manifest` as a multipart form field to the deployment endpoint. This directly addresses the Cloudflare error that occurs when the required `manifest` field is omitted. If the target Pages project does not exist, create it in Cloudflare Pages first.

This integration only deploys generated static web assets (HTML/CSS/JS and related files) to Pages; it does not convert arbitrary Node.js/Python server apps into Workers or build Android APKs.
