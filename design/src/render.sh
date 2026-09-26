# Re-render the Flow hi-fi set: bash render.sh   (needs Google Chrome + Rubik installed)
cd "$(dirname "$0")"
python3 flow.py
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --virtual-time-budget=3000 --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
for m in light dark; do
  for f in 01-home 02-project 03-review 04-add 05-projects 06-change-sheet 07-categories 08-upload-results 10-transaction-detail 11-split 12-unpaid 13-notifications 09a-onboarding 09b-onboarding 09c-onboarding 09d-onboarding 09e-onboarding; do r $f-$m 390 844; done
  r 14-settings-$m 390 1492
  r 09-onboarding-$m 2094 944
  r overview-$m 1990 1330
done
