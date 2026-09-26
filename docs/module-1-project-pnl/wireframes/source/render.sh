#!/usr/bin/env bash
# usage: bash render.sh [name ...]   (no args = all)
# gen.py writes one HTML file per screen into this directory.
# This script screenshots those files with headless Chrome and writes
# the PNGs into the parent wireframes/ directory.
cd "$(dirname "$0")"
OUT="$(cd .. && pwd)"
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=$2,$3 --screenshot="$OUT/$1.png" "file://$PWD/$1.html" 2>/dev/null; }
names=${@:-"01-home 02-project 03-review 04-add 05-projects 06-change-sheet 07-categories 08-upload-results overview overview-2 01-home-v2 06-change-sheet-v2 overview-3"}
for f in $names; do
  case $f in overview) r $f 2274 1100;; overview-2) r $f 1358 1100;; overview-3) r $f 916 1100;; *) r $f 794 920;; esac
done
