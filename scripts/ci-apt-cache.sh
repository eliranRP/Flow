#!/usr/bin/env bash
# Keeps the .deb files Playwright's install-deps downloads, so the next run reads them from the
# Actions cache instead of the Ubuntu mirror, which can stall on the font packages for minutes.
#   restore: copy cached .deb files into apt's archive folder before install-deps.
#   save:    copy apt's .deb files into the cache folder after install-deps.
set -euo pipefail

mode="${1:-}"
cache="${FLOW_APT_CACHE:-$HOME/.cache/flow-apt}"
archives="${FLOW_APT_ARCHIVES:-/var/cache/apt/archives}"
sudo_cmd="${FLOW_APT_SUDO-sudo}"

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
    echo "Usage: ci-apt-cache.sh restore|save" >&2
    exit 2
    ;;
esac
