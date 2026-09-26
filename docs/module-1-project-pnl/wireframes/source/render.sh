#!/usr/bin/env bash
# usage: bash render.sh [name ...]   (no args = all)
# gen.py writes one HTML file per screen into this directory.
# This script screenshots those files with headless Chrome and writes
# the PNGs into the parent wireframes/ directory.
cd "$(dirname "$0")"
OUT="$(cd .. && pwd)"
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=$2,$3 --screenshot="$OUT/$1.png" "file://$PWD/$1.html" 2>/dev/null; }
names=${@:-"01-home 02-project 03-review 04-add 05-projects 06-change-sheet 07-categories 08-upload-results overview overview-2 01-home-v2 06-change-sheet-v2 overview-3 03-review-v2 08-upload-results-v2 overview-4 09-onboarding 10-transaction-detail 11-split 12-unpaid 13-notifications 01-home-v3 overview-5 11-split-v2 01-home-v4 02-project-v2 overview-6"}
for f in $names; do
  case $f in overview) r $f 2274 1100;; overview-2|overview-6) r $f 1358 1100;; overview-3|overview-4|13-notifications) r $f 916 1100;; 09-onboarding) r $f 2274 1180;; overview-5) r $f 1800 1100;; *) r $f 794 920;; esac
done
