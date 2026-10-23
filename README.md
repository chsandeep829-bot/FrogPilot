# FrogPilot — Cloudflare Manifest Fix

This repository contains the updated ForgePilot AI App Builder Agent source with a Cloudflare Pages Direct Upload integration.

## Project files
The source archive is `ForgePilot_Cloudflare_Manifest_Fix.zip` in the repository. Extract it to get the Node.js server and public UI files.

## Required server environment variables
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (Pages Write permission)
- `CLOUDFLARE_PAGES_PROJECT_NAME` (an existing Direct Upload Pages project)
- `DEPLOYMENT_ACCESS_KEY` (a separate secret to protect the app's deploy endpoint)
- Existing AI settings: `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`

Do not commit `.env` files, API tokens, or passwords.

## Important
The integration deploys generated static web assets to Cloudflare Pages. It does not convert arbitrary Node.js/Python server projects or build Android APKs. A live deployment still requires valid Cloudflare credentials and an existing Pages project.