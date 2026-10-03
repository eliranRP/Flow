#!/usr/bin/env bash
# Idempotent toolchain for Cursor cloud agents.
# Installs pnpm, Deno, the Supabase CLI, and Playwright's Chromium build with its libraries.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required on the cloud agent image" >&2
  exit 1
fi
if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack is required to install pnpm" >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@10.33.3 --activate
pnpm_bin="$(command -v pnpm)"
if [[ "$pnpm_bin" != /usr/local/bin/pnpm ]]; then
  sudo ln -sfn "$pnpm_bin" /usr/local/bin/pnpm
fi

deno_version="2.9.7"
if ! command -v deno >/dev/null 2>&1 || ! deno --version | grep -q "deno ${deno_version}"; then
  tmp="$(mktemp -d)"
  asset="deno-x86_64-unknown-linux-gnu.zip"
  case "$(uname -m)" in
    aarch64|arm64) asset="deno-aarch64-unknown-linux-gnu.zip" ;;
  esac
  curl -fsSL -o "$tmp/deno.zip" "https://github.com/denoland/deno/releases/download/v${deno_version}/${asset}"
  unzip -qo "$tmp/deno.zip" -d "$tmp"
  sudo install -m 755 "$tmp/deno" /usr/local/bin/deno
  rm -rf "$tmp"
fi

supabase_version="2.118.0"
if ! command -v supabase >/dev/null 2>&1 || ! supabase --version 2>&1 | grep -q "${supabase_version}"; then
  tmp="$(mktemp -d)"
  arch="amd64"
  case "$(uname -m)" in
    aarch64|arm64) arch="arm64" ;;
  esac
  curl -fsSL -o "$tmp/supabase.tar.gz" \
    "https://github.com/supabase/cli/releases/download/v${supabase_version}/supabase_${supabase_version}_linux_${arch}.tar.gz"
  tar -xzf "$tmp/supabase.tar.gz" -C "$tmp"
  sudo install -m 755 "$tmp/supabase" /usr/local/bin/supabase
  rm -rf "$tmp"
fi

pnpm install --frozen-lockfile
pnpm --filter @flow/app exec playwright install --with-deps chromium

echo "cloud agent install ready: pnpm $(pnpm --version), $(deno --version | head -n 1), supabase $(supabase --version)"
pnpm --filter @flow/app exec playwright --version
