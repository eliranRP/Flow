# Render the remaining designs (pickers, errors, install, overhead ON, confirmations): bash render-more.sh
cd "$(dirname "$0")"
python3 flow.py && python3 more.py
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --virtual-time-budget=3000 --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
for m in light dark; do
  for f in 15a-date-field 15b-date-single 15c-date-range 16-period-sheet 17a-install-android 17b-install-iphone 18-home-overhead-on 19-project-overhead-on \
           20-confirm-delete 21-confirm-archive 22a-merge-pick 22b-merge-confirm 23-confirm-hide er-01-bank-file er-02-invoice-blurry er-03-sms-wrong er-04-sms-expired er-05-save-failed; do r $f-$m 390 844; done
  r overview-more-$m 2300 1160
done
