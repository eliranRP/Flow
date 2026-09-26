# Re-render only the screens touched by the Google sign-in decision (replaces phone-number sign-in).
# bash render-signin.sh   (needs Google Chrome + Rubik + Roboto; PY = python with Pillow for crop.py)
cd "$(dirname "$0")"
python3 flow.py && python3 more.py && python3 ds.py
PY=${PY:-/workspace/.venv/bin/python}
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --virtual-time-budget=3000 --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
rd(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
for m in light dark; do
  for f in 09a-onboarding er-03-google-cancelled er-04-google-failed; do r $f-$m 390 844; done
  r 14-settings-$m 390 1492
  r 09-onboarding-$m 2094 944
  r overview-$m 1990 1330
  r overview-more-$m 2300 1160
  rd ds-8-pickers-sheets-$m 1440 4600; $PY crop.py ds-8-pickers-sheets-$m.png
done
