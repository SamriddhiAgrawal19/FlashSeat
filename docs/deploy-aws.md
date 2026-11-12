# Deploying FlashSeat on one AWS EC2 server

This runbook puts the whole app on **one Linux server** in AWS Mumbai (`ap-south-1`):
Docker Compose runs Postgres, Redis, the API, the sweeper and Caddy, and Caddy gets an
HTTPS certificate automatically. Follow the steps in order; every command is meant to
be copied as is. Anything in `<ANGLE_BRACKETS>` is a value you fill in.

```text
Internet ──443/80──> caddy ──/api/*──> api:3000 ──> postgres, redis
                       └── everything else: the built React app
                                            sweeper ──> postgres, redis
```

Only Caddy is reachable from the internet. Postgres, Redis and the API listen only on
the private Docker network. Files involved: `docker-compose.prod.yml`,
`deploy/Caddyfile`, `deploy/Dockerfile.web`, `.env.production.example`,
`scripts/backup-db.sh`, `scripts/seed-catalog.mjs`.

> **Cost and safety.** An EC2 instance, its disk and an Elastic IP cost money while
> they exist (an Elastic IP is also billed while it is not attached). Step 13 says how
> to stop or delete everything. Never commit `.env.production`, and never paste its
> contents into a chat, ticket or screenshot.

## 1. Launch the instance (AWS console)

1. Top-right region menu: **Asia Pacific (Mumbai) ap-south-1**.
2. EC2 → **Launch instance**:
   - **Name**: `flashseat`
   - **AMI**: Ubuntu Server 24.04 LTS (64-bit x86)
   - **Instance type**: `t3.small` (2 vCPU, 2 GB RAM). The compose memory limits are
     sized for 2 GB.
   - **Key pair**: create one (type ED25519, `.pem`), download it, keep it private.
   - **Network settings → Edit → security group** `flashseat-web` with these inbound rules:

     | Type | Port | Source | Why |
     |---|---|---|---|
     | SSH | 22 | **My IP** | your SSH access only |
     | HTTP | 80 | Anywhere (0.0.0.0/0) | certificate issuance + redirect to HTTPS |
     | HTTPS | 443 | Anywhere (0.0.0.0/0) | the site |
     | Custom UDP | 443 | Anywhere (0.0.0.0/0) | HTTP/3 (optional) |

     Do **not** open 3000, 5432 or 6379. The security group is the firewall: Docker's
     published ports bypass `ufw` on the server, so don't rely on `ufw`.
   - **Storage**: 30 GiB gp3.
3. **Launch**.
4. **Elastic IP** (recommended): EC2 → Elastic IPs → Allocate → Actions → Associate →
   choose the instance. Without one, the public IP changes every time the instance is
   stopped and started, and so would the site's address and certificate.

Note the public IP, for example `13.233.10.20`. With sslip.io your site address is the
IP **with dashes**: `13-233-10-20.sslip.io` (sslip.io answers DNS for any such name with
the IP inside it, so no DNS setup is needed).

## 2. Connect

From your computer (macOS/Linux terminal, or PowerShell on Windows):

```sh
chmod 600 ~/Downloads/<your-key>.pem        # macOS/Linux only
ssh -i ~/Downloads/<your-key>.pem ubuntu@<PUBLIC_IP>
```

Everything below runs **on the server**, as the `ubuntu` user.

## 3. Install Docker Engine and the Compose plugin

The official Docker apt repository (not the `docker.io` Ubuntu package, which lacks
the compose plugin):

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Let the ubuntu user run docker without sudo, then log out and back in.
sudo usermod -aG docker ubuntu
exit
```

SSH in again, then check:

```sh
docker version          # shows both Client and Server
docker compose version  # Docker Compose version v2.x or later
```

Docker starts on boot by default, and every service has `restart: unless-stopped`, so the
app comes back by itself after a reboot.

## 4. Add a 2 GB swap file

2 GB of RAM is enough to run FlashSeat but tight while it **builds** (npm install and
the Vite build). Swap prevents out-of-memory failures:

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # keep it after reboots
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system > /dev/null
free -h   # the Swap line shows 2.0Gi
```

## 5. Get the code

```sh
cd ~
git clone https://github.com/SamriddhiAgrawal19/FlashSeat.git
cd FlashSeat
```

(For a private repository, use a GitHub deploy key or a fine-grained read-only token.)

## 6. Create `.env.production`

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

Generate the secrets. This prints nothing; it writes them straight into the file:

```sh
PGPW=$(openssl rand -hex 24)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PGPW|" .env.production
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://flashseat:$PGPW@postgres:5432/flashseat|" .env.production
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -hex 32)|" .env.production
sed -i "s|^RAZORPAY_WEBHOOK_SECRET=.*|RAZORPAY_WEBHOOK_SECRET=$(openssl rand -hex 32)|" .env.production
sed -i "s|^DEMO_PASSWORD=.*|DEMO_PASSWORD=$(openssl rand -hex 12)|" .env.production
unset PGPW
```

Set the site address (sslip.io, from the public IP):

```sh
IP=$(curl -s https://checkip.amazonaws.com)
sed -i "s|^SITE_DOMAIN=.*|SITE_DOMAIN=${IP//./-}.sslip.io|" .env.production
grep '^SITE_DOMAIN=' .env.production     # e.g. SITE_DOMAIN=13-233-10-20.sslip.io
```

Then open the file and fill in the Razorpay keys by hand:

```sh
nano .env.production    # Ctrl+O, Enter to save; Ctrl+X to exit
```

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`: Razorpay dashboard (use **Test Mode** for a
  demo) → Account & Settings → API Keys.
- Leave `NODE_ENV=production`, `ENABLE_MOCK_PAYMENT=false`, `REFRESH_COOKIE_PATH=/api/auth`
  and `TRUST_PROXY=1` as they are.

Check that no placeholder is left (this prints only line numbers and variable names):

```sh
grep -n '<' .env.production | grep -v '^[0-9]*:#' | cut -d= -f1   # no output = done
```

To see the demo organizer password later: `grep ^DEMO_PASSWORD= .env.production`.

**Using your own domain instead of sslip.io.** At your DNS provider, create an `A`
record for, say, `tickets.example.com` pointing at the Elastic IP, wait until
`dig +short tickets.example.com` prints that IP, and set
`SITE_DOMAIN=tickets.example.com`. Caddy needs ports 80 and 443 reachable to get the
certificate. If you change `SITE_DOMAIN` later, run step 7's command again.

## 7. First start

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes several minutes on a t3.small. Then:

```sh
docker compose -f docker-compose.prod.yml ps -a
```

Expected: `migrate` **Exited (0)**; `postgres`, `redis`, `api`, `sweeper` and `caddy`
**Up (healthy)**. Open `https://<SITE_DOMAIN>` in a browser; the first visit can take a
few seconds while Caddy gets the certificate. Check the API through Caddy:

```sh
curl -s https://$(grep ^SITE_DOMAIN= .env.production | cut -d= -f2)/api/health   # {"status":"ok"}
```

## 8. Migrations

They run automatically: the one-shot `migrate` service applies any pending SQL
migration on every `up`, and `api` and `sweeper` only start after it exits 0. To run
them by hand (harmless if nothing is pending):

```sh
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml logs migrate     # what it applied
```

## 9. Demo catalog (optional)

Fills the empty site with the demo organizers, venues, events and shows (no bookings;
real visitors sign up and book). It runs once and refuses to run again:

```sh
docker compose -f docker-compose.prod.yml run --rm seed-catalog
```

It prints the 3 organizer e-mails (`demo-…@flashseat.test`). Their password is
`DEMO_PASSWORD` from `.env.production`. Show dates are relative to the day you seed.

## 10. Razorpay webhook

Razorpay dashboard (same mode as your keys) → Account & Settings → Webhooks → Add New Webhook:

- **URL**: `https://<SITE_DOMAIN>/api/webhooks/razorpay`
- **Secret**: the `RAZORPAY_WEBHOOK_SECRET` value (`grep ^RAZORPAY_WEBHOOK_SECRET= .env.production`)
- **Active events**: `payment.captured`, `payment.failed`

Reachability check: an unsigned request must get **400 `INVALID_SIGNATURE`** (not 404):

```sh
curl -s -X POST https://<SITE_DOMAIN>/api/webhooks/razorpay -d '{}'
```

## 11. Daily database backup

`scripts/backup-db.sh` writes `backups/flashseat-<UTC time>.sql.gz` (owner-only file) and
deletes backups older than 7 days. Try it once:

```sh
bash scripts/backup-db.sh
ls -lh backups/
```

Schedule it every day at 03:15 server time (UTC on a fresh instance):

```sh
( crontab -l 2>/dev/null; echo "15 3 * * * bash $HOME/FlashSeat/scripts/backup-db.sh >> $HOME/FlashSeat/backups/backup.log 2>&1" ) | crontab -
crontab -l
```

These backups live on the same disk as the database, so they protect against mistakes
but not against losing the server. Copy them elsewhere now and then (for example with
`scp` to your computer), or add EBS snapshots (EC2 → Lifecycle Manager).

Restore (overwrites the current data; take a fresh backup first):

```sh
gunzip -c backups/flashseat-<TIME>.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## 12. Everyday operations

**Update to a new version:**

```sh
cd ~/FlashSeat
bash scripts/backup-db.sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps -a
docker image prune -f        # remove the old images, keep the disk from filling up
```

New migrations are applied by `migrate` during `up`. If `git pull` complains about local
changes, you edited a tracked file on the server; `git status` shows which.

If a new version adds variables to `.env.production.example`, add them to
`.env.production` too (`diff <(cut -d= -f1 .env.production.example | grep -v '^#') <(cut -d= -f1 .env.production | grep -v '^#')`).

**Logs** (JSON lines; each container keeps at most 3 × 10 MB):

```sh
docker compose -f docker-compose.prod.yml logs -f --tail 100 api      # follow the API
docker compose -f docker-compose.prod.yml logs --tail 50 sweeper
docker compose -f docker-compose.prod.yml logs --tail 50 caddy        # access log + certificates
```

What the log lines mean: [operations.md](operations.md#logs). A `Rate limit exceeded`
line shows the client's IP (`ip`).

**Resource use:** `docker stats --no-stream`, `free -h`, `df -h /`.

**Restart one service** (for example after editing `.env.production`):

```sh
docker compose -f docker-compose.prod.yml up -d          # recreates services whose config changed
docker compose -f docker-compose.prod.yml restart api    # or just restart one
```

## 13. Stop everything

```sh
docker compose -f docker-compose.prod.yml stop        # stop, keep containers and data
docker compose -f docker-compose.prod.yml start       # start again
docker compose -f docker-compose.prod.yml down        # remove containers, KEEP the data volumes
```

`docker compose -f docker-compose.prod.yml down -v` also **deletes the database and the
certificates permanently**. Only use it if you really mean to start from nothing.

To stop paying for AWS: back up first (copy `backups/` off the server), then EC2 →
Instances → **Terminate** the instance (its disk is deleted with it), and Elastic IPs →
**Release** the address. Stopping (not terminating) the instance stops the compute
charge but not the disk or the Elastic IP charge.

## Troubleshooting

| Symptom | Check |
|---|---|
| Browser: "connection refused" | Security group has 80 and 443 open; `docker compose -f docker-compose.prod.yml ps` shows caddy Up. |
| Certificate error / Caddy log mentions ACME or challenge | `SITE_DOMAIN` matches the instance's current public IP; port 80 is open. Caddy retries by itself. |
| `api` not healthy, log says `Invalid environment variables` | The log names the variable (never the value). Fix `.env.production`, then `up -d`. |
| `migrate` exited 1 | `docker compose -f docker-compose.prod.yml logs migrate`. Usually a wrong `DATABASE_URL` password (it must equal `POSTGRES_PASSWORD`). |
| Changed `POSTGRES_PASSWORD` after the first start and now nothing connects | Postgres set the password only when the volume was created. Put the old value back. |
| Logged out on every reload | `REFRESH_COOKIE_PATH=/api/auth` and `NODE_ENV=production` in `.env.production`, and the site is opened over `https://`. |
| Build killed / very slow | Swap is on (`free -h`); run the `up -d --build` again. |
