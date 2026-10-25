#!/usr/bin/env bash
# Installs or updates Kyvag CRM on an Ubuntu or Amazon Linux server, using Docker. Run as root (sudo).
# Re-running it pulls the latest code and rebuilds; the database and settings are kept.
#   sudo bash install.sh                                                        everything on one server
#   sudo ROLE=api APP_URL=http://<web server IP> bash install.sh                Postgres + API on one server...
#   sudo ROLE=web API_URL=http://<API server private IP>:4000 bash install.sh   ...web app + Caddy on another
set -euo pipefail

DIR=/opt/kyvag
REPOS=(kyvag-crm-backend crm-kyvag)
ROLE=${ROLE:-all}
ADMIN_EMAIL=${ADMIN_EMAIL:-kumaravel@kyvag.com}
ADMIN_NAME=${ADMIN_NAME:-Kumaravel M.}

case "$ROLE" in
  all) COMPOSE=docker-compose.yml ;;
  api) COMPOSE=api.compose.yml; : "${APP_URL:?ROLE=api needs APP_URL, the address people open (the web server)}" ;;
  web) COMPOSE=web.compose.yml; : "${API_URL:?ROLE=web needs API_URL, e.g. http://172.31.22.132:4000}" ;;
  *) echo "ROLE must be all, api or web" >&2; exit 1 ;;
esac

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
. /etc/os-release

# ---- Docker, git and some swap (building the web app needs ~2 GB of memory) ----
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker"
  if [ "$ID" = "amzn" ]; then
    dnf install -y docker git
    mkdir -p /usr/local/lib/docker/cli-plugins
    arch=$(uname -m); [ "$arch" = "aarch64" ] && barch=arm64 || barch=amd64
    curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$arch" -o /usr/local/lib/docker/cli-plugins/docker-compose
    curl -fsSL "https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-$barch" -o /usr/local/lib/docker/cli-plugins/docker-buildx
    chmod +x /usr/local/lib/docker/cli-plugins/*
  else
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
fi
command -v git >/dev/null || { [ "$ID" = "amzn" ] && dnf install -y git || (apt-get update && apt-get install -y git); }

if [ "$(swapon --show | wc -l)" = 0 ] && [ ! -f /swapfile ]; then
  say "Adding 2 GB of swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- Code ----
say "Getting the code"
mkdir -p "$DIR" && cd "$DIR"
for repo in "${REPOS[@]}"; do
  if [ -d "$repo/.git" ]; then git -C "$repo" pull --ff-only; else git clone "https://github.com/Kumaravel-17/$repo.git"; fi
done

# ---- Settings (first run only) ----
cd "$DIR/kyvag-crm-backend/deploy"
first_run=0
if [ ! -f .env ]; then
  first_run=1
  ip=$(curl -fsS -m 5 https://checkip.amazonaws.com || hostname -I | awk '{print $1}')
  {
    if [ "$ROLE" != web ]; then
      echo "APP_URL=${APP_URL:-http://$ip}"
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    fi
    if [ "$ROLE" != api ]; then
      echo "SITE_ADDRESS=:80"
      echo "FRONTEND_DIR=../../crm-kyvag"
    fi
    if [ "$ROLE" = web ]; then echo "API_URL=$API_URL"; fi
    echo "COOKIE_SECURE=false"
  } > .env
  chmod 600 .env
fi

# ---- Build and start ----
say "Building and starting (the first build takes a few minutes)"
docker compose -f "$COMPOSE" up -d --build --remove-orphans
# Build leftovers fill small disks quickly
docker builder prune -af >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true

if [ "$ROLE" = web ]; then
  say "Waiting for the web app"
  for _ in $(seq 60); do curl -fsS -o /dev/null http://localhost/login && break; sleep 3; done
  say "Web app is running at http://$(curl -fsS -m 5 https://checkip.amazonaws.com || echo '<this server>')"
  exit 0
fi

say "Waiting for the API"
for _ in $(seq 60); do
  docker compose -f "$COMPOSE" exec -T backend node -e "fetch('http://localhost:4000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null && break
  sleep 3
done

if [ "$first_run" = 1 ]; then
  say "Creating the sign-in account"
  password=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16)
  docker compose -f "$COMPOSE" exec -T -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_PASSWORD="$password" -e ADMIN_NAME="$ADMIN_NAME" backend node dist/create-admin.js
  printf 'Email: %s\nPassword: %s\n' "$ADMIN_EMAIL" "$password" > /root/kyvag-login.txt
  chmod 600 /root/kyvag-login.txt
  echo "Email:    $ADMIN_EMAIL"
  echo "Password: $password   (also saved in /root/kyvag-login.txt)"
fi

say "Kyvag CRM is running; open $(grep '^APP_URL=' .env | cut -d= -f2-)"
