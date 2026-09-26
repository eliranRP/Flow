# Re-render the design-system boards: bash render-ds.sh   (crop step needs Pillow: /workspace/.venv/bin/python or any python with PIL)
cd "$(dirname "$0")"
python3 flow.py >/dev/null   # regenerates 01-home-*.html (used on page 6)
python3 states.py            # es-/ld- html (used on page 7)
python3 more.py              # 15–23 / er- html (used on page 8)
python3 ds.py
PY=${PY:-/workspace/.venv/bin/python}
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
for m in light dark; do
  r 01-home-$m 390 844
  for p in ds-1-colours ds-2-type ds-3-spacing ds-4-controls ds-5-content ds-6-band; do r $p-$m 1440 3000; $PY crop.py $p-$m.png; done
  r ds-7-empty-loading-$m 1440 4000; $PY crop.py ds-7-empty-loading-$m.png
  r ds-8-pickers-sheets-$m 1440 4200; $PY crop.py ds-8-pickers-sheets-$m.png
done
