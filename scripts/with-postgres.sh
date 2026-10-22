#!/usr/bin/env bash
# Run a command with a throwaway Postgres in Docker:
#
#   bash scripts/with-postgres.sh lgx test    # or: lgx test-pg
#
# Starts postgres:17-alpine on a free loopback port, waits until it accepts
# connections, runs the command with QUEL_PG_URL pointing at it, and
# removes the container afterwards, whatever the command's outcome. The
# command's exit status is the script's.
set -euo pipefail

name="quel-pg-$$"
image="postgres:17-alpine"
password="quel"

cleanup() {
    docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d --name "$name" -e POSTGRES_PASSWORD="$password" \
    -p 127.0.0.1::5432 "$image" >/dev/null

# pg_isready inside the container answers before the server listens on
# TCP during the image's init restart, so wait for a real query instead.
ready=""
for _ in $(seq 1 60); do
    if docker exec "$name" psql -U postgres -h 127.0.0.1 -tAc "select 1" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 0.5
done
if [[ -z "$ready" ]]; then
    echo "with-postgres: $image did not become ready" >&2
    docker logs "$name" >&2 || true
    exit 1
fi

port="$(docker port "$name" 5432/tcp | head -n1 | sed 's/.*://')"
export QUEL_PG_URL="postgres://postgres:$password@127.0.0.1:$port/postgres"
echo "with-postgres: $QUEL_PG_URL"

"$@"
