# Installation Guide

Complete setup instructions for Oikos - from Docker installation to your first login.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Step-by-Step Installation](#step-by-step-installation)
- [Environment Variables](#environment-variables)
- [HTTPS / Reverse Proxy (Nginx)](#https--reverse-proxy-nginx)
- [Updates](#updates)
- [Backup & Restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

---

## Architecture Overview

Oikos is a self-hosted family planner that runs as a single Docker container. The Express.js backend serves both the API and the static frontend files. All data is stored in a SQLCipher-encrypted SQLite database inside a Docker volume.

```
Browser ──HTTP──▶ Docker Container (Express.js :3000) ──▶ SQLite/SQLCipher (/data/oikos.db)

With HTTPS (recommended for network access):
Browser ──HTTPS──▶ Nginx (Reverse Proxy) ──HTTP──▶ Docker Container (Express.js :3000) ──▶ SQLite/SQLCipher
```

For local-only access, the Docker container is all you need. If you want to access Oikos from other devices on your network or the internet, add Nginx as a reverse proxy with SSL.

---

## Prerequisites

### Docker & Docker Compose

Docker packages your application and all its dependencies into a container, so you don't need to install Node.js, SQLCipher, or anything else on your host system. Docker Compose orchestrates the container using a simple configuration file.

Install Docker for your platform:

- **Linux**: [docs.docker.com/engine/install](https://docs.docker.com/engine/install/)
- **macOS**: [docs.docker.com/desktop/install/mac-install](https://docs.docker.com/desktop/install/mac-install/)
- **Windows**: [docs.docker.com/desktop/install/windows-install](https://docs.docker.com/desktop/install/windows-install/)

Verify your installation:

```bash
docker --version           # Docker version 27.x.x or later
docker compose version     # Docker Compose version v2.x.x
```

### Git

You need Git to clone the repository and pull updates later.

- **All platforms**: [git-scm.com/downloads](https://git-scm.com/downloads)

```bash
git --version              # git version 2.x.x
```

### System Requirements

- **RAM**: 256 MB minimum (the container is lightweight)
- **Disk**: ~500 MB for the Docker image, plus space for your database

---

## Step-by-Step Installation

There are two ways to get Oikos running. **Option A** (pre-built image) is recommended for most users — no clone required. **Option B** (build from source) is for contributors or if you want to run a custom version.

---

### Option A — Pre-built Image (Recommended)

A ready-to-use Docker image is published to the GitHub Container Registry on every release. You only need two files.

#### 1. Download the Compose File and Example Config

```bash
curl -O https://raw.githubusercontent.com/ulsklyc/oikos/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/ulsklyc/oikos/main/.env.example
```

#### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and set at minimum the two required secrets:

```bash
SESSION_SECRET=<YOUR-SECRET>
DB_ENCRYPTION_KEY=<YOUR-SECRET>
```

Generate a secure value for each:

```bash
openssl rand -hex 32
```

Run this command **twice** and paste each result. See [Environment Variables](#environment-variables) for all options.

#### 3. Start the Container

```bash
docker compose up -d
```

Docker pulls `ghcr.io/ulsklyc/oikos:latest` automatically. No build step, no Node.js installation needed.

Continue with [Step 4 — Verify](#4-verify-the-container-is-running).

---

### Option B — Build from Source

#### 1. Clone the Repository

```bash
git clone https://github.com/ulsklyc/oikos.git
cd oikos
```

#### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and set the two required secrets (see above). Generate them with `openssl rand -hex 32`.

#### 3. Build and Start the Container

```bash
docker compose up -d --build
```

- `--build` compiles the Docker image locally (SQLCipher dependencies, npm packages).
- `-d` runs the container in the background.

The first build takes a few minutes. Subsequent starts are much faster.

### 4. Verify the Container is Running <a name="4-verify-the-container-is-running"></a>

Check the logs to confirm a successful start:

```bash
docker compose logs -f
```

You should see output like:

```
oikos  | [Oikos] Server läuft auf Port 3000
oikos  | [Oikos] Umgebung: production
oikos  | [Sync] Auto-Sync alle 15 Minuten aktiv.
```

Press `Ctrl+C` to stop following the logs (the container keeps running).

### 5. Run the Initial Setup

Create the first admin account:

```bash
docker compose exec oikos node setup.js
```

The interactive setup asks you for:
- **Username** (minimum 3 characters)
- **Display name** (e.g. "Jane Doe")
- **Password** (minimum 8 characters, entered with masked input)

### 6. Open Oikos

Open your browser and navigate to:

```
http://localhost:3000
```

Log in with the admin credentials you just created. You can add family members from the **Settings** page.

---

## Environment Variables

All configuration happens in the `.env` file. The container reads these values on startup.

### Server

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Port the Express server listens on | `3000` | No |
| `NODE_ENV` | Runtime environment | `production` | No |

### Security

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SESSION_SECRET` | Secret key for signing session cookies. **Change this!** | - | **Yes** |
| `SESSION_SECURE` | Set to `false` if accessing without HTTPS (e.g. direct localhost). Set in `docker-compose.yml` by default. | `true` | No |
| `RATE_LIMIT_WINDOW_MS` | Time window for rate limiting (ms) | `60000` | No |
| `RATE_LIMIT_MAX_ATTEMPTS` | Max login attempts per window | `5` | No |
| `RATE_LIMIT_BLOCK_DURATION_MS` | Block duration after exceeding limit (ms) | `900000` | No |

Generate a secure `SESSION_SECRET`:

```bash
openssl rand -hex 32
```

### Database

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DB_PATH` | Path to the SQLite database file inside the container | `/data/oikos.db` | No |
| `DB_ENCRYPTION_KEY` | Encryption key for SQLCipher AES-256. **Change this!** | - | **Yes** |

Generate a secure `DB_ENCRYPTION_KEY`:

```bash
openssl rand -hex 32
```

> **Warning**: If you lose this key, you cannot access your database. Keep a backup of your `.env` file in a safe place.

### Weather (Optional)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `OPENWEATHER_API_KEY` | API key from [openweathermap.org](https://openweathermap.org/api) | - | No |
| `OPENWEATHER_CITY` | City name for weather display | `Berlin` | No |
| `OPENWEATHER_UNITS` | Unit system (`metric` or `imperial`) | `metric` | No |
| `OPENWEATHER_LANG` | Language for weather descriptions | `de` | No |

### Google Calendar Sync (Optional)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console | - | No |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret | - | No |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `https://<YOUR-DOMAIN>/api/v1/calendar/google/callback` | No |

### Apple Calendar Sync (Optional)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `APPLE_CALDAV_URL` | CalDAV server URL | `https://caldav.icloud.com` | No |
| `APPLE_USERNAME` | Apple ID email | - | No |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (generate at [appleid.apple.com](https://appleid.apple.com/)) | - | No |

### Sync

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SYNC_INTERVAL_MINUTES` | Calendar sync interval in minutes | `15` | No |

---

## HTTPS / Reverse Proxy (Nginx)

> **Optional for local access, required for network/internet access.** If you only access Oikos on the same machine (localhost), you can skip this section.

When exposing Oikos to your local network or the internet, you need HTTPS for security. Nginx acts as a reverse proxy that handles SSL termination and forwards requests to the Docker container.

### Install Nginx

On Debian/Ubuntu:

```bash
sudo apt install nginx
```

### Configure Nginx

Oikos ships with an example configuration. Copy it to Nginx:

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/oikos
sudo ln -s /etc/nginx/sites-available/oikos /etc/nginx/sites-enabled/
```

Edit the file and replace `deine-domain.de` with your actual domain:

```bash
sudo nano /etc/nginx/sites-available/oikos
```

The configuration includes:
- HTTP-to-HTTPS redirect
- Proxy pass to the Docker container on port 3000
- WebSocket upgrade headers (for connection upgrades)
- Security headers (HSTS, X-Frame-Options, etc.)
- Static asset caching

### Enable HTTPS with Let's Encrypt

Install Certbot and obtain a free SSL certificate:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR-DOMAIN>
```

Certbot automatically modifies the Nginx configuration to include your certificates.

Verify auto-renewal is active:

```bash
sudo certbot renew --dry-run
```

### Update Oikos for HTTPS

When using HTTPS through a reverse proxy, remove or comment out the `SESSION_SECURE=false` line in `docker-compose.yml`:

```yaml
environment:
  - NODE_ENV=production
  - DB_PATH=/data/oikos.db
  # - SESSION_SECURE=false   # Remove this for HTTPS
```

Then restart the container:

```bash
docker compose up -d
```

---

## Updates

### Option A — Pre-built Image

Pull the latest published image and restart:

```bash
docker compose pull
docker compose up -d
```

No rebuild needed. The database volume persists across updates.

### Option B — Build from Source

```bash
cd oikos
git pull
docker compose up -d --build
```

### When to Stop First

If the [CHANGELOG](../CHANGELOG.md) mentions database migrations or breaking changes, stop the container before updating:

```bash
# Option A (pre-built)
docker compose pull
docker compose down
docker compose up -d

# Option B (build from source)
docker compose down
git pull
docker compose up -d --build
```

> **Recommendation**: Read the CHANGELOG before every update. Back up your database beforehand (see next section).

---

## Backup & Restore

### Where is the Data?

The SQLite database lives in a Docker named volume called `oikos_data`, mounted at `/data` inside the container. The database file is `/data/oikos.db`.

### Backup

Copy the database from the running container to your host:

```bash
docker compose exec oikos cp /data/oikos.db /data/oikos-backup.db
docker cp oikos:/data/oikos-backup.db ./oikos-backup-$(date +%Y%m%d).db
docker compose exec oikos rm /data/oikos-backup.db
```

### Restore

Copy a backup file back into the container and restart:

```bash
docker cp ./oikos-backup-20260401.db oikos:/data/oikos.db
docker compose restart
```

### Automated Backups

Add a cron job to back up daily (adjust the path to your preference):

```bash
crontab -e
```

Add this line:

```
0 3 * * * docker cp oikos:/data/oikos.db /path/to/backups/oikos-$(date +\%Y\%m\%d).db
```

This creates a backup at 3:00 AM every day.

---

## Troubleshooting

<details>
<summary>Port already in use</summary>

If port 3000 is already occupied by another application:

```bash
lsof -i :3000
```

Either stop the conflicting process, or change the port in your `.env` file and `docker-compose.yml`:

```yaml
ports:
  - "0.0.0.0:8080:3000"
```

</details>

<details>
<summary>Permission denied (Docker)</summary>

If Docker commands fail with "permission denied":

```bash
sudo usermod -aG docker $USER
```

Log out and back in (or reboot) for the group change to take effect.

</details>

<details>
<summary>Container starts but page is not reachable</summary>

1. Check the container status:
   ```bash
   docker compose ps
   ```
   The state should show "Up" and "healthy".

2. Check the logs for errors:
   ```bash
   docker compose logs
   ```

3. Verify the port mapping:
   ```bash
   docker port oikos
   ```

4. Check your firewall rules if accessing from another device.

</details>

<details>
<summary>Database encryption error</summary>

If the logs show SQLCipher errors, the `DB_ENCRYPTION_KEY` in your `.env` file is either missing or does not match the key used when the database was created.

If this is a fresh install, delete the volume and start over:

```bash
docker compose down -v
docker compose up -d --build
```

If you have existing data, you need the original encryption key. There is no way to recover data without it.

</details>

<details>
<summary>SQLCipher build fails during Docker build</summary>

> **Tip**: If you hit build issues, switch to the pre-built image (Option A above) — it ships with SQLCipher already compiled and requires no local build step.

The Dockerfile installs these build dependencies: `python3`, `make`, `g++`, `libsqlcipher-dev`. If the build fails, ensure your Docker installation is up to date and has internet access to pull packages.

On resource-constrained systems, the native compilation may run out of memory. Ensure at least 1 GB of RAM is available during the build.

</details>

<details>
<summary>Nginx 502 Bad Gateway</summary>

This means Nginx cannot reach the Docker container. Check:

1. Is the container running?
   ```bash
   docker compose ps
   ```

2. Is the `proxy_pass` port in your Nginx config correct? It should match the host port in `docker-compose.yml` (default: `3000`).

3. Is the container listening on the expected port?
   ```bash
   docker compose logs | grep "Server läuft"
   ```

</details>

---

## Uninstall

Remove the container, volumes, and all data:

```bash
docker compose down -v
```

Remove the repository:

```bash
cd .. && rm -rf oikos
```

> **Warning**: `docker compose down -v` permanently deletes all data including the database. Create a backup first if needed.
