# Relax QC Control Center — Deployment Package

This package is prepared for deployment as a Node.js/Express Web Service.

## Option A — Free Render deployment (best for testing/demo)

Render supports Node/Express Web Services on its Free plan and gives the service a public `onrender.com` URL.

1. Create a GitHub repository and upload this entire project.
2. In Render, choose **New → Web Service** and connect the GitHub repository.
3. Use:
   - Runtime: **Node**
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
   - Plan: **Free**
4. Add these environment variables in Render:
   - `RELAX_OWNER_USERNAME`
   - `RELAX_OWNER_PASSWORD`
   - `RELAX_EMPLOYER1_PASSWORD`
   - `RELAX_EMPLOYER2_PASSWORD`
   - `RELAX_EMPLOYER3_PASSWORD`
   - `RELAX_EMPLOYER4_PASSWORD`
5. Deploy.
6. Render will give you a public URL such as `https://relax-qc-control-center.onrender.com`.

The included `render.yaml` can also be used for a Render Blueprint deployment.

## IMPORTANT: Free hosting and QC evidence storage

The app currently stores job records in `data/store.json` and evidence files in `uploads/`.
Render Free Web Services have an **ephemeral filesystem**. Local files can be lost when the service redeploys, restarts, or spins down.

Therefore, the free deployment should be treated as a **testing/demo deployment**, not as the permanent production system for important QC records.

For a permanent production deployment, use one of these approaches:

### Production approach 1 — Render paid service + persistent disk

Set:

`RELAX_DATA_DIR=/var/data`

`RELAX_UPLOAD_DIR=/var/data/uploads`

Attach a Render persistent disk mounted at `/var/data`.

This preserves both the JSON records and uploaded evidence. Persistent disks are not available on Render Free services.

### Production approach 2 — Database + object storage

For a larger/multi-user production system, move job data to PostgreSQL and evidence to object storage. This is the recommended long-term architecture if the application will become business-critical.

## Local run

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Health check

`GET /api/health` returns a simple JSON response used by Render to verify that the service is running.

## Security

Do not publish real passwords inside GitHub. Set credentials as Render environment variables. The source code retains the previous default credentials only as a local-development fallback.
