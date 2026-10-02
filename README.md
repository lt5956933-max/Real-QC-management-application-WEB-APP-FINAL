# Relax QC Control Center — Cloud / Internet Edition

This is the Internet-ready version of the Relax Techno Fab QC Control Center.

## What changed

- Node.js + Express backend remains the application server.
- Job/checklist data is stored in PostgreSQL instead of a local JSON file.
- Evidence files are stored under `STORAGE_ROOT` so a cloud persistent disk can preserve them.
- Login protection is included (admin account configured by environment variables).
- The server binds to `0.0.0.0` and respects the platform `PORT` variable.
- HTTPS is terminated by the hosting platform in production.
- The browser UI remains the same QC checklist with 20 stages.
- Android can later be pointed to the public HTTPS URL instead of `192.168.1.110:3000`.

## Recommended deployment: Render

Render supports Node/Express web services and provides a public `onrender.com` URL. It can connect the service to managed PostgreSQL and attach a persistent disk for evidence files.

### 1. Put this project in GitHub

Create a private GitHub repository and upload the contents of this folder.

Do NOT upload `.env` or real passwords.

### 2. Create the cloud service

In Render:

1. New → Blueprint.
2. Select your GitHub repository.
3. Render will read `render.yaml`.
4. When prompted for `ADMIN_PASSWORD`, enter a strong password.
5. Deploy the Blueprint.

The Blueprint creates:

- `relax-qc-control-center` web service
- `relax-qc-db` PostgreSQL database
- persistent `/var/data` disk for evidence

The web service will receive a public HTTPS URL such as:

`https://relax-qc-control-center.onrender.com`

Use the exact URL Render gives you.

### 3. Login

Default username from the Blueprint:

`admin`

Password: the value you entered for `ADMIN_PASSWORD`.

Change the password by updating the Render environment variable and redeploying. The application only creates the admin user automatically if it does not already exist.

### 4. Test

Open the public HTTPS URL on:

- office PC
- another PC on a different Internet connection
- Android phone on 4G/5G

All clients use the same cloud database.

### 5. Android app

After the cloud URL is working, change the Android app's server URL from:

`http://192.168.1.110:3000`

to the Render HTTPS URL, for example:

`https://relax-qc-control-center.onrender.com`

Do not use the example URL unless Render actually assigned it to your service.

## Local development

This cloud edition expects PostgreSQL. Copy `.env.example` to `.env` and provide a PostgreSQL connection string, then:

```bash
npm install
npm start
```

For local testing, set `NODE_ENV=development` and use a local PostgreSQL database.

## Important storage note

Render filesystems are ephemeral unless a persistent disk is attached. This project therefore uses `/var/data` and the included Blueprint attaches a persistent disk there. A persistent disk pins the service to one instance; if you later need horizontal scaling, move evidence files to shared object storage instead.

## Security

- Use a strong `ADMIN_PASSWORD`.
- Keep the GitHub repository private.
- Never commit `.env` or database credentials.
- Use the HTTPS URL supplied by the cloud host.
- Back up important QC records.

## Source checklist

The 20-stage QC flow in this project is based on the Relax Techno Fab contractor QC checklist supplied for this project, including mandatory QC witness/hold stages, evidence/photo requirements, hydrotest, PWHT, painting and final confirmations.
