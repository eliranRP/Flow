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

verify_sha256() {
  local file="$1"
  local expected="$2"
  if [[ ! -f "$file" ]]; then
    echo "missing download: $file" >&2
    exit 1
  fi
  local actual
  actual="$(sha256sum "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "checksum mismatch for $file" >&2
    exit 1
  fi
}

deno_version="2.9.7"
deno_sha256_x86_64="c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490"
deno_sha256_aarch64="c832298b1ad4422481334855f6003e0f54145762c5a134f20a489511d2f65bbf"
if ! command -v deno >/dev/null 2>&1 || ! deno --version | grep -q "deno ${deno_version}"; then
  tmp="$(mktemp -d)"
  asset="deno-x86_64-unknown-linux-gnu.zip"
  deno_sha256="$deno_sha256_x86_64"
  case "$(uname -m)" in
    aarch64|arm64)
      asset="deno-aarch64-unknown-linux-gnu.zip"
      deno_sha256="$deno_sha256_aarch64"
      ;;
  esac
  curl -fsSL -o "$tmp/deno.zip" "https://github.com/denoland/deno/releases/download/v${deno_version}/${asset}"
  verify_sha256 "$tmp/deno.zip" "$deno_sha256"
  unzip -qo "$tmp/deno.zip" -d "$tmp"
  sudo install -m 755 "$tmp/deno" /usr/local/bin/deno
  rm -rf "$tmp"
fi

supabase_version="2.118.0"
supabase_sha256_amd64="f6089a86fb9d9221c958193a277338daddd6822f706929943812fa32e106c86d"
supabase_sha256_arm64="0cd35fea97c2c93dce8a2cd661311be88c107233946cbe3692566196238859c5"
if ! command -v supabase >/dev/null 2>&1 || ! supabase --version 2>&1 | grep -q "${supabase_version}"; then
  tmp="$(mktemp -d)"
  arch="amd64"
  supabase_sha256="$supabase_sha256_amd64"
  case "$(uname -m)" in
    aarch64|arm64)
      arch="arm64"
      supabase_sha256="$supabase_sha256_arm64"
      ;;
  esac
  curl -fsSL -o "$tmp/supabase.tar.gz" \
    "https://github.com/supabase/cli/releases/download/v${supabase_version}/supabase_${supabase_version}_linux_${arch}.tar.gz"
  verify_sha256 "$tmp/supabase.tar.gz" "$supabase_sha256"
  tar -xzf "$tmp/supabase.tar.gz" -C "$tmp"
  sudo install -m 755 "$tmp/supabase" /usr/local/bin/supabase
  rm -rf "$tmp"
fi

pnpm install --frozen-lockfile
pnpm --filter @flow/app exec playwright install --with-deps chromium

echo "cloud agent install ready: pnpm $(pnpm --version), $(deno --version | head -n 1), supabase $(supabase --version)"
pnpm --filter @flow/app exec playwright --version
