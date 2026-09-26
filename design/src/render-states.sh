# Render empty states + loaders: bash render-states.sh   (needs Google Chrome + Rubik; flow.py first so 01-home/03-review html exist)
cd "$(dirname "$0")"
python3 flow.py && python3 states.py
r(){ google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --allow-file-access-from-files --virtual-time-budget=3000 --window-size=$2,$3 --screenshot=$PWD/$1.png file://$PWD/$1.html 2>/dev/null; }
for m in light dark; do
  for f in es-01-home-first-run es-02-project-empty es-03-review-done es-04-projects-none es-05-unpaid-none es-06-search-none es-07-categories-income es-08-notifications-off \
           ld-01-home-skeleton ld-02-project-skeleton ld-03-list-skeleton ld-04-button-loading ld-05-upload-processing ld-06-invoice-reading ld-07-pull-to-refresh ld-08-offline ld-09-offline-cached; do r $f-$m 390 844; done
  r overview-states-$m 2080 1160
done
