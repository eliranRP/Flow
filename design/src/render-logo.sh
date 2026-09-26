# Re-render only the screens touched by the logo decision (0031): wordmark colour off-band + S1 app icon.
# bash render-logo.sh   (needs Google Chrome + Rubik; PY = python with Pillow for crop.py)
cd "$(dirname "$0")"
python3 flow.py && python3 more.py && python3 states.py && python3 ds.py
PY=${PY:-/workspace/.venv/bin/python}
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --virtual-time-budget=3000 --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
rd(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
for m in light dark; do
  for f in 09a-onboarding 09e-onboarding 13-notifications 17a-install-android 17b-install-iphone; do r $f-$m 390 844; done
  r 09-onboarding-$m 2094 944
  r overview-$m 1990 1330
  r overview-more-$m 2300 1160
  r overview-states-$m 2080 1160
  for p in ds-1-colours ds-2-type ds-3-spacing ds-4-controls ds-5-content ds-6-band; do rd $p-$m 1440 3000; $PY crop.py $p-$m.png; done
  rd ds-7-empty-loading-$m 1440 4000; $PY crop.py ds-7-empty-loading-$m.png
  rd ds-8-pickers-sheets-$m 1440 4200; $PY crop.py ds-8-pickers-sheets-$m.png
done
