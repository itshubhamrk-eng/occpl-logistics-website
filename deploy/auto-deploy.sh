#!/usr/bin/env bash
# Deploys occplsoftech/occpl-logistics-website when main changes. Run from cron on the server; needs no keys or secrets.
# Installed as a separate copy (see README), so merging to main changes the site but never this script or the Compose file.
# Order: build, smoke-test a candidate, switch, check the public site, roll back if it fails.
set -euo pipefail
BASE=${BASE:-$HOME/occpl-website-auto}
REPO=${REPO:-https://github.com/occplsoftech/occpl-logistics-website.git}
PUBLIC_URL=${PUBLIC_URL:-https://pro.occpllogistics.com}
IMG=occpl-website
CAND=occpl-website-candidate
export PATH=/usr/local/bin:/usr/bin:/bin
cd "$BASE"
exec 9>.lock; flock -n 9 || exit 0

log() { echo "$(date -u +%FT%TZ) $*"; }
sha=$(git ls-remote "$REPO" refs/heads/main | cut -f1)
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { log "cannot read main"; exit 1; }
[ "$sha" = "$(cat deployed 2>/dev/null || true)" ] && exit 0
[ "$sha" = "$(cat failed 2>/dev/null || true)" ] && exit 0   # tried once; a newer merge, or deleting this file, tries again

work=$(mktemp -d "$BASE/build.XXXXXX")
cleanup() { docker rm -f "$CAND" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
fail() { log "FAILED $sha: $*"; echo "$sha" > failed; exit 1; }

log "deploying $sha"
git clone -q --depth 1 --branch main "$REPO" "$work" || { log "clone failed, will retry"; exit 1; }
[ "$(git -C "$work" rev-parse HEAD)" = "$sha" ] || { log "main moved, will retry"; exit 0; }
timeout 300 docker build -q --memory 512m --build-arg SITE_URL="$PUBLIC_URL" -t "$IMG:$sha" "$work" >/dev/null 2>build.log || fail "build (see build.log)"

# Candidate: no public ports and no network alias, so no visitor reaches it.
docker rm -f "$CAND" >/dev/null 2>&1 || true
docker run -d --name "$CAND" --network occpl_default --memory 64m --cpus 0.5 \
  -e COURIER_API=https://courier.dev.occplsoftech.com -e COURIER_API_HOST=courier.dev.occplsoftech.com "$IMG:$sha" >/dev/null || fail "candidate start"
sleep 3
inside() { timeout 15 docker exec "$CAND" wget -q -T 10 -O /dev/null "http://127.0.0.1$1"; }
for p in / /about/ /services/ /track/ /branches/ /contact/ /sitemap.xml /assets/js/site.js; do
  inside "$p" || fail "candidate $p"
done
docker rm -f "$CAND" >/dev/null

previous=$(docker inspect -f '{{.Image}}' occpl-website-web-1 2>/dev/null || true)
up() { IMAGE="$1" timeout 120 docker compose -p occpl-website -f "$BASE/docker-compose.yml" up -d --no-build --pull never >/dev/null 2>&1; }
healthy() {
  local i p
  for i in $(seq 1 12); do
    sleep 5
    for p in / /services/ /track/; do curl -fsS -m 10 -o /dev/null "$PUBLIC_URL$p" 2>/dev/null || continue 2; done
    return 0
  done
  return 1
}
if up "$IMG:$sha" && healthy; then
  echo "$sha" > deployed; rm -f failed
  docker tag "$IMG:$sha" "$IMG:local"
  log "deployed $sha"
else
  if [ -n "$previous" ]; then
    docker tag "$previous" "$IMG:rollback"
    if up "$IMG:rollback"; then log "rolled back to $previous"; else log "ROLLBACK FAILED"; fi
  fi
  fail "public check"
fi
# Keep this site's 5 newest images; images of other applications are never touched.
docker images "$IMG" --format '{{.Tag}}' | { grep -E '^[0-9a-f]{40}$' || true; } | tail -n +6 | while read -r t; do docker rmi "$IMG:$t" >/dev/null 2>&1 || true; done
[ -f deploy.log ] && [ "$(wc -c < deploy.log)" -gt 1000000 ] && : > deploy.log
exit 0
