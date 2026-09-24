#!/usr/bin/env bash
# Restores the seeded snapshot, then runs one scenario. Usage:
#   sim/run.sh <scenario> [minutes]   (API must already be running on :4000)
set -euo pipefail
cd "$(dirname "$0")"
DUMP="${SIM_DUMP:?set SIM_DUMP to the pg_dump taken right after seed.mjs}"
PGPASSWORD="${PGPASSWORD:-erp_dev_pw}" pg_restore -h localhost -U erp_app -d erp_dev --clean --if-exists "$DUMP"
SIM_SCENARIO="$1" SIM_MINUTES="${2:-12}" node day.mjs
