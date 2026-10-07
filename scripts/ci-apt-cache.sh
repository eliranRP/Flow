#!/usr/bin/env bash
# Keeps the .deb files Playwright's install-deps downloads, so the next run reads them from the
# Actions cache instead of the Ubuntu mirror, which can stall on the font packages for minutes.
#   restore: copy cached .deb files into apt's archive folder before install-deps.
#   install: install the missing packages from those files without touching the mirror. Only when
#            that does not cover them all, run apt-get update and download the rest.
#   save:    copy apt's .deb files into the cache folder after install-deps.
#   psql:    make sure psql is there (the runner image has it), installing postgresql-client if not.
# Every apt-get that reaches the mirror is cut off after FLOW_APT_TIMEOUT seconds and tried once more
# against archive.ubuntu.com, because the runner's Azure mirror can trickle for many minutes.
set -euo pipefail

mode="${1:-}"
cache="${FLOW_APT_CACHE:-$HOME/.cache/flow-apt}"
archives="${FLOW_APT_ARCHIVES:-/var/cache/apt/archives}"
sudo_cmd="${FLOW_APT_SUDO-sudo}"
playwright="${FLOW_PLAYWRIGHT:-pnpm --filter @flow/app exec playwright}"
apt_get="${FLOW_APT_GET:-$sudo_cmd apt-get}"
apt_timeout="${FLOW_APT_TIMEOUT:-100}"
sources="${FLOW_APT_SOURCES:-/etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources}"

# Runs apt-get with a time limit. If it fails, points apt at archive.ubuntu.com and tries once more.
apt_mirror() {
  if timeout "$apt_timeout" $apt_get "$@"; then return 0; fi
  echo "apt: apt-get $1 failed or stalled; switching to archive.ubuntu.com and trying again."
  for file in $sources; do
    [[ -f "$file" ]] && $sudo_cmd sed -i 's#://[a-z.]*archive\.ubuntu\.com#://archive.ubuntu.com#g' "$file"
  done
  timeout "$apt_timeout" $apt_get "$@"
}

missing_packages() {
  sed -n 's/^  \([a-z0-9][a-z0-9.+-]*\)$/\1/p' <<<"$1" | tr '\n' ' '
}

case "$mode" in
  restore)
    mkdir -p "$cache"
    # apt-get keeps downloaded files unless a clean hook removes them.
    if [[ -z "${FLOW_APT_ARCHIVES:-}" ]]; then
      echo 'APT::Keep-Downloaded-Packages "true";' | $sudo_cmd tee /etc/apt/apt.conf.d/99flow-keep-debs >/dev/null
      # A stalled mirror connection gives up after 30 seconds and is retried, instead of hanging the job.
      printf '%s\n' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' 'Acquire::Retries "5";' \
        | $sudo_cmd tee /etc/apt/apt.conf.d/99flow-retry >/dev/null
      $sudo_cmd rm -f /etc/apt/apt.conf.d/docker-clean
    fi
    shopt -s nullglob
    debs=("$cache"/*.deb)
    if (( ${#debs[@]} == 0 )); then
      echo "apt cache: empty, install-deps downloads everything."
      exit 0
    fi
    $sudo_cmd cp "${debs[@]}" "$archives"/
    echo "apt cache: restored ${#debs[@]} packages."
    ;;
  install)
    # --dry-run lists the missing packages (and exits 1) without running apt-get update.
    if report="$($playwright install-deps --dry-run chromium 2>&1)"; then
      echo "apt cache: $report"
      exit 0
    fi
    missing="$(missing_packages "$report")"
    if [[ -n "$missing" ]] && $apt_get install -y --no-install-recommends --no-download $missing \
      && $playwright install-deps --dry-run chromium; then
      echo "apt cache: installed the missing packages from the cache."
      exit 0
    fi
    echo "apt cache: the cache does not cover every package, so they are downloaded."
    apt_mirror update
    if report="$($playwright install-deps --dry-run chromium 2>&1)"; then
      echo "apt cache: $report"
      exit 0
    fi
    missing="$(missing_packages "$report")"
    if [[ -z "$missing" ]]; then
      echo "$report" >&2
      exit 1
    fi
    apt_mirror install -y --no-install-recommends $missing
    $playwright install-deps --dry-run chromium
    ;;
  psql)
    if command -v "${FLOW_PSQL:-psql}" >/dev/null; then
      echo "psql: $("${FLOW_PSQL:-psql}" --version)"
      exit 0
    fi
    apt_mirror update
    apt_mirror install -y --no-install-recommends postgresql-client
    ;;
  save)
    mkdir -p "$cache"
    shopt -s nullglob
    debs=("$archives"/*.deb)
    if (( ${#debs[@]} > 0 )); then
      cp "${debs[@]}" "$cache"/
    fi
    echo "apt cache: saved ${#debs[@]} packages."
    ;;
  *)
    echo "Usage: ci-apt-cache.sh restore|install|save|psql" >&2
    exit 2
    ;;
esac
