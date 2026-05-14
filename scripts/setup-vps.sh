#!/usr/bin/env bash
# ============================================================
# setup-vps.sh — One-time VPS bootstrap script
# Run as root on a fresh Ubuntu 22.04 VPS:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/YOUR_REPO/main/scripts/setup-vps.sh | bash
# ============================================================
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RAG Teaching Material — VPS Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. System update
apt-get update && apt-get upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# 3. Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# 4. Install Nginx + Certbot
apt-get install -y nginx certbot python3-certbot-nginx ufw curl wget git

# 5. Firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# 6. Create deploy user
if ! id "deploy" &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
fi
usermod -aG docker deploy

# 7. Setup SSH for deploy user
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# 8. Create app directory
mkdir -p /home/deploy/app
chown deploy:deploy /home/deploy/app

# 9. Create backup directory
mkdir -p /home/deploy/backups
chown deploy:deploy /home/deploy/backups

# 10. Cron: daily DB backup at 3am
CRON_JOB="0 3 * * * cp /home/deploy/app/RAG_Teaching_Material/uploads/rag_auth.db /home/deploy/backups/rag_auth_\$(date +\%Y\%m\%d).db 2>/dev/null || true"
(crontab -u deploy -l 2>/dev/null; echo "$CRON_JOB") | crontab -u deploy -

echo ""
echo "✅ VPS setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add GitHub Actions SSH key to /home/deploy/.ssh/authorized_keys"
echo "  2. SSH as deploy: su - deploy"
echo "  3. Clone repo: cd ~/app && git clone https://github.com/YOUR_ORG/YOUR_REPO.git"
echo "  4. Set up .env: cd RAG_Teaching_Material && cp .env.example .env && nano .env"
echo "  5. SSL: certbot --nginx -d yourdomain.com"
echo "  6. First deploy: docker compose -f docker-compose.prod.yml up -d"
