#!/usr/bin/env bash
# WebWaka Cross-Cutting — Cloudflare Infrastructure Provisioning
# Run once per environment to create D1 + KV resources and patch wrangler.toml.
#
# Prerequisites:
#   - wrangler authenticated: wrangler login  OR  CLOUDFLARE_API_TOKEN env var set
#
# Usage:
#   ENV=production ./scripts/provision-infra.sh
#   ENV=staging    ./scripts/provision-infra.sh

set -euo pipefail
ENV="${ENV:-production}"
echo "=== Provisioning webwaka-cross-cutting infrastructure (env: $ENV) ==="

# ─── D1 Database ─────────────────────────────────────────────────────────────
DB_NAME="webwaka-cross-cutting-db-${ENV}"
echo ""
echo "→ Creating D1 database: $DB_NAME"

DB_OUTPUT=$(npx wrangler d1 create "$DB_NAME" --json 2>/dev/null || true)

if echo "$DB_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('uuid',''))" 2>/dev/null | grep -q "."; then
  DB_ID=$(echo "$DB_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['uuid'])")
  echo "  ✅ Created D1: $DB_ID"
else
  echo "  ℹ️  D1 database may already exist, fetching ID..."
  DB_ID=$(npx wrangler d1 list --json 2>/dev/null \
    | python3 -c "import sys,json; dbs=json.load(sys.stdin); match=[d for d in dbs if d['name']=='$DB_NAME']; print(match[0]['uuid'] if match else '')" 2>/dev/null || echo "")
  if [[ -z "$DB_ID" ]]; then
    echo "  ❌ Could not find or create D1 database $DB_NAME"; exit 1
  fi
  echo "  ✅ Found existing D1: $DB_ID"
fi

# ─── KV Namespaces ───────────────────────────────────────────────────────────
create_kv() {
  local NS_TITLE="$1"
  echo ""
  echo "→ Creating KV namespace: $NS_TITLE"
  KV_OUTPUT=$(npx wrangler kv namespace create "$NS_TITLE" --json 2>/dev/null || true)
  local KV_ID
  KV_ID=$(echo "$KV_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
  if [[ -z "$KV_ID" ]]; then
    echo "  ℹ️  KV may already exist, fetching ID..."
    KV_ID=$(npx wrangler kv namespace list --json 2>/dev/null \
      | python3 -c "import sys,json; ns=json.load(sys.stdin); match=[n for n in ns if n['title']=='$NS_TITLE']; print(match[0]['id'] if match else '')" 2>/dev/null || echo "")
    if [[ -z "$KV_ID" ]]; then
      echo "  ❌ Could not find or create KV namespace $NS_TITLE"; exit 1
    fi
    echo "  ✅ Found existing KV: $KV_ID"
  else
    echo "  ✅ Created KV: $KV_ID"
  fi
  echo "$KV_ID"
}

SESSIONS_KV_ID=$(create_kv "webwaka-cross-cutting-sessions-${ENV}")
TENANT_KV_ID=$(create_kv "webwaka-cross-cutting-tenant-config-${ENV}")

# ─── Run Migrations ──────────────────────────────────────────────────────────
echo ""
echo "→ Running D1 migrations against: $DB_NAME"
for SQL_FILE in migrations/*.sql; do
  echo "  Applying: $SQL_FILE"
  npx wrangler d1 execute "$DB_NAME" \
    --file="$SQL_FILE" \
    --remote 2>&1 | grep -Ev "^$|^\s*$" || true
done
echo "  ✅ All migrations applied"

# ─── Patch wrangler.toml ─────────────────────────────────────────────────────
echo ""
echo "→ Patching wrangler.toml with resolved IDs..."

python3 - "$ENV" "$DB_ID" "$SESSIONS_KV_ID" "$TENANT_KV_ID" << 'PYEOF'
import sys

env, db_id, sessions_kv, tenant_kv = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

with open('wrangler.toml') as f:
    content = f.read()

if env == 'production':
    content = content.replace('REPLACE_WITH_D1_DATABASE_ID', db_id)
    content = content.replace('REPLACE_WITH_KV_NAMESPACE_ID', sessions_kv)
    content = content.replace('REPLACE_WITH_TENANT_KV_ID', tenant_kv)
elif env == 'staging':
    content = content.replace('REPLACE_WITH_STAGING_D1_ID', db_id)

with open('wrangler.toml', 'w') as f:
    f.write(content)

print(f"  ✅ wrangler.toml updated for env: {env}")
PYEOF

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
printf "║  %-60s║\n" "Provisioning complete — env: $ENV"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  D1 DB ID    : %-46s║\n" "$DB_ID"
printf "║  Sessions KV : %-46s║\n" "$SESSIONS_KV_ID"
printf "║  Tenant KV   : %-46s║\n" "$TENANT_KV_ID"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  %-60s║\n" "Next steps:"
printf "║  %-60s║\n" "1. Commit the updated wrangler.toml"
printf "║  %-60s║\n" "2. Set secrets:"
printf "║  %-60s║\n" "   npx wrangler secret put JWT_SECRET --env $ENV"
printf "║  %-60s║\n" "   npx wrangler secret put INTER_SERVICE_SECRET --env $ENV"
printf "║  %-60s║\n" "   npx wrangler secret put AI_PLATFORM_TOKEN --env $ENV"
printf "║  %-60s║\n" "3. Deploy:"
printf "║  %-60s║\n" "   npx wrangler deploy --env $ENV"
echo "╚══════════════════════════════════════════════════════════════╝"
