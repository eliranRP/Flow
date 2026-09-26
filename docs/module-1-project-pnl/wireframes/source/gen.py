# Generates low-fi wireframe HTML for each screen + overview
import pathlib
OUT = pathlib.Path(__file__).parent

CSS = r"""
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo','Noto Sans Hebrew',sans-serif;background:#eceae6;color:#333;-webkit-font-smoothing:antialiased}
.wrap{display:flex;gap:28px;padding:28px;align-items:flex-start}
.phone{width:410px;height:864px;border:10px solid #3a3a3a;border-radius:52px;background:#fff;position:relative;overflow:hidden;flex:none;box-shadow:0 4px 18px rgba(0,0,0,.12)}
.screen{direction:rtl;position:absolute;inset:0;display:flex;flex-direction:column;background:#f6f6f6}
.status{height:44px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 28px;font-size:13px;color:#777;direction:ltr}
.status .notch{width:120px;height:26px;background:#3a3a3a;border-radius:0 0 16px 16px;position:absolute;left:50%;top:0;transform:translateX(-50%)}
.content{flex:1;overflow:hidden;padding:4px 16px 12px}
.topbar{display:flex;align-items:center;justify-content:space-between;margin:4px 0 12px}
.title{font-size:22px;font-weight:700;color:#222}
.sub{font-size:13px;color:#888}
.iconbtn{width:40px;height:40px;border-radius:12px;background:#e4e4e4;display:flex;align-items:center;justify-content:center;font-size:18px;color:#666}
.seg{display:flex;background:#e2e2e2;border-radius:12px;padding:4px;margin-bottom:12px}
.seg div{flex:1;text-align:center;padding:9px 0;font-size:15px;border-radius:9px;color:#666}
.seg .on{background:#fff;color:#222;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.card{background:#fff;border:1.5px solid #d6d6d6;border-radius:14px;padding:12px}
.kpis{display:flex;gap:8px;margin-bottom:12px}
.kpi{flex:1;background:#fff;border:1.5px solid #d6d6d6;border-radius:14px;padding:10px 8px;text-align:center}
.kpi .l{font-size:13px;color:#777}
.kpi .v{font-size:20px;font-weight:700;margin-top:2px;color:#333}
.kpi.big{border-width:2px;border-color:#9aa}
.num{direction:ltr;unicode-bidi:isolate;display:inline-block}
.pos{color:#2e7d32}.neg{color:#c62828}
.sect{font-size:14px;font-weight:600;color:#666;margin:12px 2px 8px;display:flex;justify-content:space-between}
.sect a{color:#5b6b8a;font-weight:500;text-decoration:none}
.row{background:#fff;border:1.5px solid #d6d6d6;border-radius:12px;padding:10px 12px;margin-bottom:8px}
.row .top{display:flex;justify-content:space-between;align-items:center;font-size:16px}
.row .name{font-weight:600;color:#333}
.row .meta{font-size:12px;color:#999;margin-top:2px}
.bar{height:10px;background:#ececec;border-radius:5px;margin-top:8px;display:flex;overflow:hidden}
.bar .e{background:#a9a9a9}.bar .p{background:#8fbf92}.bar .n{background:#e3a0a0}
.banner{display:flex;align-items:center;gap:10px;background:#e7eaf0;border:1.5px dashed #5b6b8a;border-radius:14px;padding:12px;font-size:16px;font-weight:600;color:#3e4a63;margin-bottom:12px}
.banner .dot{width:30px;height:30px;border-radius:50%;background:#5b6b8a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;flex:none}
.banner .go{margin-inline-start:auto;font-size:20px}
.nav{height:84px;flex:none;background:#fff;border-top:1.5px solid #ddd;display:flex;align-items:flex-start;justify-content:space-around;padding:8px 6px 0;position:relative}
.nav .it{width:64px;text-align:center;font-size:12px;color:#888;position:relative}
.nav .ic{width:26px;height:26px;border:2px solid #aaa;border-radius:7px;margin:0 auto 4px}
.nav .it.on{color:#222;font-weight:700}.nav .it.on .ic{border-color:#444;background:#ddd}
.nav .plus{width:64px;height:64px;border-radius:50%;background:#5b6b8a;color:#fff;font-size:38px;line-height:60px;text-align:center;margin-top:-26px;box-shadow:0 3px 8px rgba(0,0,0,.25);font-weight:300}
.badge{position:absolute;top:-6px;left:10px;background:#c62828;color:#fff;font-size:11px;font-weight:700;min-width:20px;height:20px;border-radius:10px;line-height:20px;padding:0 5px}
.homeind{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:130px;height:5px;border-radius:3px;background:#bbb}
.chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #5b6b8a;background:#eef0f5;color:#3e4a63;border-radius:20px;padding:6px 12px;font-size:15px;font-weight:600}
.chip small{font-weight:400;color:#7a86a0;font-size:12px}
.btn{height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
.btn.pri{background:#5b6b8a;color:#fff}
.btn.sec{background:#fff;border:2px solid #999;color:#444}
.btn.ghost{background:transparent;border:1.5px dashed #999;color:#555;font-weight:600;font-size:16px;height:48px}
.ph{background:repeating-linear-gradient(45deg,#e6e6e6 0 8px,#dcdcdc 8px 16px);border:1.5px solid #c8c8c8;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px}
.overlay{position:absolute;inset:0;background:rgba(40,40,40,.45)}
.sheet{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;padding:10px 16px 30px;direction:rtl}
.grab{width:44px;height:5px;background:#ccc;border-radius:3px;margin:0 auto 14px}
.opt{display:flex;align-items:center;gap:14px;border:1.5px solid #d0d0d0;border-radius:16px;padding:16px;margin-bottom:10px;background:#fafafa}
.opt .ic{width:52px;height:52px;border-radius:14px;background:#e2e2e2;border:1.5px solid #bbb;flex:none;display:flex;align-items:center;justify-content:center;font-size:22px;color:#666}
.opt .t{font-size:18px;font-weight:700;color:#333}
.opt .d{font-size:13px;color:#888;margin-top:2px}
.field{border:1.5px solid #bbb;border-radius:12px;height:52px;padding:0 14px;display:flex;align-items:center;font-size:16px;color:#aaa;background:#fff;margin-bottom:10px}
.field.focus{border-color:#5b6b8a;border-width:2px;color:#333}
.lbl{font-size:13px;color:#777;margin:0 2px 4px}
.notes{width:300px;flex:none;direction:ltr;font-family:'Heebo',sans-serif;padding-top:6px}
.notes h2{font-size:20px;color:#222;margin-bottom:2px}
.notes .he{font-size:15px;color:#666;margin-bottom:12px;direction:rtl;text-align:left}
.notes .n{background:#fffbe6;border:1px solid #e3d9a6;border-left:4px solid #c9b458;border-radius:6px;padding:9px 11px;margin-bottom:9px;font-size:13.5px;line-height:1.4;color:#444}
.notes .n b{color:#222}
.exlabel{position:absolute;top:18px;left:28px;font-size:13px;background:#fff;border:1px dashed #999;color:#777;padding:3px 10px;border-radius:6px;font-family:'Heebo',sans-serif}
.cat{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:4px}
.cat .cn{width:84px;color:#555;flex:none}
.cat .cb{flex:1;height:12px;background:#ececec;border-radius:6px;overflow:hidden}
.cat .cb div{height:100%;background:#a9a9a9}
.cat .cv{width:70px;text-align:left;color:#444;flex:none;font-weight:600}
.tx{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #eee}
.tx:last-child{border-bottom:none}
.tx .si,.opt .ic,.emo{filter:grayscale(1)}
.tx .si{width:32px;height:32px;border-radius:8px;background:#e6e6e6;border:1.5px solid #ccc;flex:none;display:flex;align-items:center;justify-content:center;font-size:13px;color:#777}
.tx .tn{flex:1;font-size:14px;color:#333;font-weight:500}
.tx .tm{font-size:11.5px;color:#999}
.tx .ta{font-size:15px;font-weight:700}
"""

def num(v, cls=""):
    s = f"{abs(v):,}"
    sign = "−" if v < 0 else ("+" if cls == "signed" and v > 0 else "")
    c = "neg" if v < 0 else ("pos" if cls in ("pl", "signed") else "")
    return f'<span class="num {c}">{sign}₪{s}</span>'

STATUS = '<div class="status"><span>9:41</span><div class="notch"></div><span>▮▮▮ ◔</span></div>'

def nav(active, badge=True):
    items = [("home", "בית"), ("proj", "פרויקטים"), ("plus", ""), ("rev", "לאישור"), ("set", "הגדרות")]
    h = '<div class="nav">'
    for k, t in items:
        if k == "plus":
            h += '<div class="it"><div class="plus">+</div></div>'
            continue
        b = '<span class="badge">7</span>' if (k == "rev" and badge) else ""
        h += f'<div class="it {"on" if k == active else ""}"><div class="ic"></div>{t}{b}</div>'
    return h + '<div class="homeind"></div></div>'

def phone(inner, extra=""):
    return f'<div class="phone"><div class="screen">{STATUS}{inner}</div>{extra}</div>'

def projrow(name, meta, inc, exp, scale=200000):
    prof = inc - exp
    if prof >= 0:
        bar = f'<div class="e" style="width:{exp/scale*100:.1f}%"></div><div class="p" style="width:{prof/scale*100:.1f}%"></div>'
    else:
        bar = f'<div class="e" style="width:{inc/scale*100:.1f}%"></div><div class="n" style="width:{-prof/scale*100:.1f}%"></div>'
    return f'''<div class="row"><div class="top"><span class="name">{name}</span>{num(prof,"pl")}</div>
<div class="meta">הכנסות {num(inc)} · הוצאות {num(exp)}{meta}</div><div class="bar">{bar}</div></div>'''

# ---------- 1 HOME ----------
home_content = f'''<div class="content">
<div class="topbar"><div><div class="title">שלום, יוסי</div><div class="sub">סיכום החברה · ספטמבר 2026</div></div><div class="iconbtn">☰</div></div>
<div class="seg"><div class="on">החודש</div><div>מתחילת השנה</div></div>
<div class="kpis">
<div class="kpi"><div class="l">הכנסות</div><div class="v">{num(420000)}</div></div>
<div class="kpi"><div class="l">הוצאות</div><div class="v">{num(330000)}</div></div>
<div class="kpi big"><div class="l">רווח/הפסד</div><div class="v">{num(90000,"pl")}</div></div>
</div>
<div class="banner"><span class="dot">7</span>7 פריטים ממתינים לאישור<span class="go">‹</span></div>
<div class="sect"><span>פרויקטים</span><a>הכל ‹</a></div>
{projrow("וילה רעננה","",180000,130000)}
{projrow("בניין מגורים חולון","",180000,110000)}
{projrow('שיפוץ דירה ת"א',"",60000,70000)}
<div class="row" style="background:#f0f0f0;border-style:dashed"><div class="top"><span class="name">הוצאות כלליות</span>{num(-20000)}</div><div class="meta">תקורה של החברה · לא משויך לפרויקט</div></div>
</div>'''
home_inner = home_content + nav("home")

# ---------- 2 PROJECT ----------
cats = [("חומרים",300000),("קבלני משנה",220000),("עבודה",120000),("ציוד והשכרה",40000),("הובלה",20000),("ביטוח",10000),("אחר",10000)]
cat_html = "".join(f'<div class="cat"><span class="cn">{n}</span><div class="cb"><div style="width:{v/300000*100:.0f}%"></div></div><span class="cv">{num(v)}</span></div>' for n,v in cats)
txs = [("🧾","טמבור בע\"מ","חומרים · 22/09",-12000),("🏦","העברה מהלקוח – משפ׳ כהן","הכנסה · 20/09",150000),("🧾","אבי חשמל","קבלני משנה · 18/09",-18000)]
tx_html = "".join(f'<div class="tx"><div class="si">{i}</div><div class="tn">{n}<div class="tm">{m}</div></div><span class="ta">{num(v,"signed")}</span></div>' for i,n,m,v in txs)
proj_inner = f'''<div class="content">
<div class="topbar"><div class="iconbtn">›</div><div style="flex:1;margin-inline-start:10px"><div class="title">וילה רעננה</div><div class="sub">לקוח: משפ׳ כהן · מתחילת הפרויקט</div></div><div class="iconbtn">⋯</div></div>
<div class="kpis">
<div class="kpi"><div class="l">הכנסות</div><div class="v">{num(900000)}</div></div>
<div class="kpi"><div class="l">הוצאות</div><div class="v">{num(720000)}</div></div>
<div class="kpi big"><div class="l">רווח · 20%</div><div class="v">{num(180000,"pl")}</div></div>
</div>
<div class="card" style="margin-bottom:10px;padding:10px 12px">
<div style="display:flex;justify-content:space-between;font-size:14px"><span style="font-weight:600;color:#555">הוצאות מול תקציב</span><span style="color:#777">{num(720000)} / {num(1000000)}</span></div>
<div class="bar" style="height:14px;border-radius:7px"><div class="e" style="width:72%"></div></div>
<div style="font-size:12px;color:#999;margin-top:4px"><span class="num">72%</span> נוצל · אופציונלי</div></div>
<div class="card" style="margin-bottom:10px;padding:8px 12px"><div style="font-size:14px;font-weight:600;color:#555;margin-bottom:6px">לפי קטגוריה</div>{cat_html}</div>
<div class="card" style="padding:4px 12px"><div class="sect" style="margin:6px 0 0"><span>תנועות אחרונות</span><a>הכל ‹</a></div>{tx_html}</div>
</div>''' + nav("proj")

# ---------- 3 REVIEW ----------
rev_inner = f'''<div class="content">
<div class="topbar"><div><div class="title">לאישור</div><div class="sub">מה שה-AI לא היה בטוח בו</div></div><div style="font-size:15px;font-weight:700;color:#555;background:#e4e4e4;border-radius:10px;padding:8px 12px">3 מתוך 7</div></div>
<div style="display:flex;gap:4px;margin-bottom:12px">{''.join(f'<div style="flex:1;height:5px;border-radius:3px;background:{"#5b6b8a" if i<3 else "#d8d8d8"}"></div>' for i in range(7))}</div>
<div class="card" style="padding:16px;border-width:2px;border-color:#bbb">
<div style="display:flex;gap:12px">
<div class="ph" style="width:92px;height:118px;flex:none">חשבונית</div>
<div style="flex:1">
<div style="font-size:12px;color:#999;display:flex;align-items:center;gap:6px"><span class="si" style="width:22px;height:22px;border:1.5px solid #bbb;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:11px" class="emo">📷</span>חשבונית מצולמת</div>
<div style="font-size:19px;font-weight:700;margin-top:6px;color:#222">חומרי בניין השרון בע״מ</div>
<div style="font-size:14px;color:#888;margin-top:2px">21/09/2026</div>
<div style="font-size:28px;font-weight:800;margin-top:6px;color:#222">{num(8500)}</div>
<div style="font-size:12px;color:#999">לפני מע״מ · מע״מ {num(1530)}</div>
</div></div>
<div style="border-top:1px solid #eee;margin:14px 0 10px"></div>
<div style="font-size:13px;color:#777;margin-bottom:6px">הצעת AI</div>
<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
<div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;color:#888;width:60px">פרויקט</span><span class="chip">וילה רעננה <small>92%</small></span></div>
<div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;color:#888;width:60px">קטגוריה</span><span class="chip">חומרים <small>95%</small></span></div>
</div></div>
<div style="display:flex;gap:10px;margin-top:14px">
<div class="btn pri" style="flex:2">✓ אישור</div>
<div class="btn sec" style="flex:1">שינוי</div></div>
<div style="font-size:12.5px;color:#888;text-align:center;margin:8px 0 10px">אחרי שינוי – נזכור את הבחירה לספק הזה</div>
<div class="btn ghost">אשר הכל · 4 בביטחון גבוה</div>
<div style="text-align:center;font-size:14px;color:#777;margin-top:6px">דלג ›</div>
<div class="sect" style="margin-top:6px"><span>הבא בתור</span></div>
<div class="row" style="opacity:.7;display:flex;align-items:center;gap:10px"><span class="emo" style="width:32px;height:32px;border-radius:8px;background:#e6e6e6;border:1.5px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:13px">🏦</span><div style="flex:1"><div class="name" style="font-size:15px">העברה ל״מ.ש. הובלות״</div><div class="meta">שורת בנק · 19/09 · לא הותאם</div></div>{num(-3000)}</div>
</div>''' + nav("rev")

# ---------- 4 ADD SHEET ----------
add_sheet = '''<div class="overlay"></div><div class="sheet">
<div class="grab"></div>
<div style="font-size:20px;font-weight:700;margin-bottom:4px;color:#222">הוספה</div>
<div style="font-size:13px;color:#888;margin-bottom:14px">ה-AI ישייך לפרויקט ולקטגוריה – אתה רק מאשר</div>
<div class="opt"><div class="ic">📷</div><div><div class="t">צלם חשבונית</div><div class="d">מצלמה או PDF · קורא ספק, סכום, מע״מ ותאריך</div></div></div>
<div class="opt"><div class="ic">📄</div><div><div class="t">העלה דוח בנק/אשראי</div><div class="d">קובץ Excel / CSV · התאמה אוטומטית</div></div></div>
<div class="opt"><div class="ic">✎</div><div><div class="t">הזנה ידנית</div><div class="d">סכום, פרויקט וקטגוריה – במקרה הצורך</div></div></div>
<div class="btn sec" style="height:50px;margin-top:6px;font-weight:600">ביטול</div>
</div>'''
add_extra = add_sheet

# ---------- 5 PROJECTS ----------
def plrow(name, client, inc, exp, status="פעיל"):
    p = inc - exp
    return f'''<div class="row" style="padding:12px"><div class="top"><span class="name">{name}</span>{num(p,"pl")}</div>
<div class="meta">{client} · {status} · הכנסות {num(inc)}</div></div>'''
projs_inner = f'''<div class="content">
<div class="topbar"><div><div class="title">פרויקטים</div><div class="sub">3 פעילים · רווח מתחילת הפרויקט</div></div><div class="iconbtn">⌕</div></div>
<div class="btn pri" style="margin-bottom:12px">+ פרויקט חדש</div>
{plrow("וילה רעננה","משפ׳ כהן",900000,720000)}
{plrow("בניין מגורים חולון","יזם: א.ב. נכסים",1500000,1150000)}
{plrow('שיפוץ דירה ת"א',"משפ׳ לוי",200000,215000)}
<div class="sect"><span>הסתיימו</span><a>הצג ‹</a></div>
</div>''' + nav("proj")
projs_sheet = '''<div class="overlay"></div><div class="sheet">
<div class="grab"></div>
<div style="font-size:19px;font-weight:700;margin-bottom:12px;color:#222">פרויקט חדש</div>
<div class="lbl">שם הפרויקט *</div>
<div class="field focus">גן יבנה – תוספת קומה<span style="border-right:2px solid #5b6b8a;height:22px;margin-right:2px"></span></div>
<div style="display:flex;gap:8px">
<div style="flex:1"><div class="lbl">לקוח (אופציונלי)</div><div class="field">שם לקוח</div></div>
<div style="flex:1"><div class="lbl">תקציב (אופציונלי)</div><div class="field">₪</div></div></div>
<div class="btn pri" style="margin-top:4px">צור פרויקט</div>
</div>'''

SCREENS = [
 ("01-home","Home / Company","בית", phone(home_inner), [
  "<b>Purpose:</b> 5-second answer to “am I making money?” across the whole company. Cash basis, amounts net of VAT.",
  "<b>Period switcher</b> <bdi dir=rtl>החודש / מתחילת השנה</bdi> — one tap, recalculates all numbers.",
  "<b>3 big numbers:</b> income (bank deposits), expenses (payments), profit/loss (green/red).",
  "<b>Pending banner</b> → opens the Review queue (לאישור).",
  "<b>Project rows:</b> tap → Project view. Bar = gray expenses + green profit (or red loss) on a shared scale.",
  "<b>הוצאות כלליות</b> is a separate dashed row: company overhead, not a project — keeps project P&L honest.",
  "<b>Bottom nav:</b> thumb zone; big center + opens the Add sheet; badge on לאישור."]),
 ("02-project","Project view","פרויקט", phone(proj_inner), [
  "<b>Purpose:</b> is this job profitable? Totals since project start.",
  "<b>KPIs:</b> income / expenses / profit, with margin % in the profit tile.",
  "<b>Budget vs actual</b> (optional, only if a budget was entered): expenses used vs planned.",
  "<b>By category:</b> the 7 fixed categories as simple bars — spot where money goes.",
  "<b>Recent transactions:</b> source icon (🧾 invoice / 🏦 bank row), signed amounts. Tap a row → edit project/category.",
  "<b>⋯ menu:</b> edit name/client/budget, close project."]),
 ("03-review","Review queue","לאישור", phone(rev_inner), [
  "<b>Purpose:</b> “confirm, don’t type.” Only unmatched / low-confidence items land here.",
  "<b>One big card</b> at a time: supplier, date, net amount (VAT below), source icon, invoice thumbnail (tap to zoom).",
  "<b>AI chips:</b> suggested project + category with confidence %. Tapping a chip = quick change.",
  "<b>אישור</b> (primary, thumb-reachable) → next card. <b>שינוי</b> → picker for project/category.",
  "<b>Learning:</b> after a correction the app remembers the rule for that supplier and applies it next time. Example: supplier <bdi dir=rtl>השרון</bdi> → project <bdi dir=rtl>וילה רעננה</bdi>, category <bdi dir=rtl>חומרים</bdi>.",
  "<b>אשר הכל</b> bulk-confirms high-confidence items. Counter + progress bar show position (3 of 7). Swipe = skip."]),
 ("04-add","Add (+) bottom sheet","הוספה", phone(home_inner, add_extra), [
  "<b>Purpose:</b> the single entry point for new data, opened by the center + button from any screen.",
  "<b>צלם חשבונית:</b> camera or PDF. AI extracts supplier, amount, VAT, date → item goes to review with suggestions.",
  "<b>העלה דוח בנק/אשראי:</b> Excel/CSV. Rows auto-matched to known suppliers/invoices; only unmatched rows go to לאישור.",
  "<b>הזנה ידנית:</b> fallback only — amount + project + category, with smart defaults.",
  "Big 80px+ rows, sheet sits in the thumb zone; tap outside or ביטול to dismiss.",
  "POC: no Morning/iCount integration and no invoicing."]),
 ("05-projects","Projects list + create","פרויקטים", phone(projs_inner, projs_sheet), [
  "<b>Purpose:</b> all active projects with profit to date; tap → Project view.",
  "<b>פרויקט חדש</b> opens a tiny sheet (shown open here over the list).",
  "<b>Create sheet:</b> only the name is required; client and budget are optional and can be added later.",
  "Finished projects collapse under הסתיימו.",
  "Search (⌕) for contractors with many jobs."]),
]

def page(body, w, h):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS} html,body{{width:{w}px;height:{h}px}}</style></head><body>{body}</body></html>'

for fid, en, he, ph, notes in SCREENS:
    nh = "".join(f'<div class="n">{n}</div>' for n in notes)
    body = f'<div class="wrap">{ph}<div class="notes"><h2>{fid[:2]} · {en}</h2><div class="he">{he}</div>{nh}</div></div>'
    (OUT / f"{fid}.html").write_text(page(body, 794, 920), encoding="utf-8")

# overview: phones side by side, short caption under each
cols = ""
for fid, en, he, ph, notes in SCREENS:
    cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{fid[:2]} · {en} <span style="font-weight:400;color:#777">· {he}</span></div>{ph}<div class="notes" style="width:410px"><div class="n">{notes[0]}</div></div></div>'
ov = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">Example data · low-fi wireframe · POC</div>
<div style="position:absolute;top:18px;right:32px;font-size:14px;color:#777">Construction P&amp;L – mobile POC · Hebrew RTL · 390×844</div>
<div style="display:flex;gap:32px">{cols}</div></div>'''
(OUT / "overview.html").write_text(page(ov, 2274, 1100), encoding="utf-8")
print("ok")

# =================== BATCH 2 (06-08) ===================
CSS += r"""
.pick{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.pc{border:1.5px solid #c8c8c8;background:#fff;border-radius:20px;padding:8px 14px;font-size:15px;color:#444}
.pc.sel{border:2px solid #5b6b8a;background:#eef0f5;color:#2f3a52;font-weight:700}
.pc.add{border-style:dashed;color:#5b6b8a;background:transparent}
.toggle{width:46px;height:28px;border-radius:14px;background:#5b6b8a;position:relative;flex:none}
.toggle::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff}
.crow{display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid #d6d6d6;border-radius:12px;padding:0 12px;height:52px;margin-bottom:7px;font-size:16px}
.crow .h{color:#aaa;font-size:16px;letter-spacing:-2px;width:18px}
.crow .cn{flex:1;font-weight:600;color:#333}
.crow .cc{font-size:12.5px;color:#999}
.crow .mm{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#777;font-size:18px}
.menu{position:absolute;left:24px;width:236px;background:#fff;border:1.5px solid #bbb;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:6px 0;z-index:5}
.menu .mi{padding:10px 16px;font-size:16px;color:#333;border-bottom:1px solid #eee}
.menu .mi.dis{color:#bbb}
.menu .mn{padding:8px 16px 6px;font-size:12px;color:#888;line-height:1.35}
.brow{display:flex;align-items:center;gap:12px;background:#fff;border:1.5px solid #d6d6d6;border-radius:12px;padding:10px 12px;margin-bottom:8px}
.brow .bi{width:38px;height:38px;border-radius:10px;background:#e6e6e6;border:1.5px solid #c8c8c8;display:flex;align-items:center;justify-content:center;font-size:17px;color:#666;flex:none}
.brow .bc{font-size:22px;font-weight:800;color:#333;width:34px;text-align:center;flex:none}
.brow .bt{flex:1;font-size:15px;color:#444;line-height:1.3}
.brow .bt small{display:block;font-size:12px;color:#999}
"""

# ---------- 06 CHANGE SHEET ----------
change_sheet = f'''<div class="overlay"></div><div class="sheet" style="padding-bottom:26px">
<div class="grab"></div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
<div><div style="font-size:19px;font-weight:700;color:#222">שינוי שיוך</div><div style="font-size:13px;color:#888">חומרי בניין השרון בע״מ · 21/09</div></div>
<div style="font-size:20px;font-weight:800;color:#222">{num(8500)}</div></div>
<div class="lbl" style="font-weight:600;font-size:14px;color:#555">פרויקט</div>
<div class="pick"><span class="pc">וילה רעננה</span><span class="pc sel">✓ בניין מגורים חולון</span><span class="pc">שיפוץ דירה ת"א</span><span class="pc">הוצאות כלליות</span><span class="pc add">+ פרויקט חדש</span></div>
<div style="font-size:14px;color:#5b6b8a;font-weight:600;margin:4px 2px 12px">⇆ פצל בין פרויקטים ›</div>
<div class="lbl" style="font-weight:600;font-size:14px;color:#555">קטגוריה</div>
<div class="pick"><span class="pc sel">✓ חומרים</span><span class="pc">קבלני משנה</span><span class="pc">עבודה</span><span class="pc">ציוד והשכרה</span><span class="pc">הובלה</span><span class="pc">ביטוח</span><span class="pc">אחר</span><span class="pc add">+ קטגוריה חדשה</span></div>
<div style="display:flex;align-items:center;gap:12px;background:#f3f4f7;border-radius:12px;padding:12px;margin:12px 0 14px">
<div style="flex:1"><div style="font-size:15px;font-weight:600;color:#333">לזכור לספק הזה</div><div style="font-size:12.5px;color:#888">חומרי בניין השרון → חולון · חומרים</div></div><div class="toggle"></div></div>
<div class="btn pri">שמור ואשר</div>
</div>'''

# ---------- 07 CATEGORIES ----------
ccats = [("חומרים",124),("קבלני משנה",38),("עבודה",52),("ציוד והשכרה",17),("הובלה",21),("ביטוח",4),("אחר",9)]
crows = "".join(f'<div class="crow"><span class="h">⋮⋮</span><span class="cn">{n}</span><span class="cc">{c} תנועות</span><span class="mm" style="{"background:#e4e4e4" if n=="הובלה" else ""}">⋯</span></div>' for n,c in ccats)
cat_inner = f'''<div class="content" style="position:relative">
<div class="topbar"><div class="iconbtn">›</div><div style="flex:1;margin-inline-start:10px"><div class="sub">הגדרות ›</div><div class="title">קטגוריות</div></div></div>
<div class="seg"><div class="on">הוצאות</div><div>הכנסות</div></div>
{crows}
<div class="row" style="display:flex;justify-content:space-between;align-items:center;background:#f0f0f0;border-style:dashed;height:46px;padding:0 12px"><span style="font-weight:600;color:#666;font-size:15px">מוסתרות (1)</span><span style="color:#999">⌄</span></div>
<div class="btn ghost" style="margin-top:4px">+ קטגוריה חדשה</div>
<div class="menu" style="top:402px">
<div class="mi">✎ שנה שם</div><div class="mi">◌ הסתר</div><div class="mi">⇢ מזג לקטגוריה אחרת</div><div class="mi dis" style="border-bottom:none">🗑 מחק</div>
<div class="mn">מחיקה אפשרית רק לקטגוריה ללא תנועות</div></div>
</div>''' + nav("set")

# ---------- 08 UPLOAD RESULTS ----------
up_inner = f'''<div class="content">
<div class="topbar"><div><div class="title">דוח בנק הועלה</div><div class="sub"><span class="emo">📄</span> <bdi dir=ltr>לאומי_ספטמבר.xlsx</bdi> · <span class="num">01–30/09</span></div></div><div class="iconbtn">✕</div></div>
<div class="card" style="text-align:center;padding:14px;margin-bottom:10px;border-width:2px;border-color:#bbb">
<div style="font-size:34px;font-weight:800;color:#222;line-height:1.1">42</div><div style="font-size:16px;color:#555">שורות נקלטו</div>
<div class="bar" style="height:12px;border-radius:6px;margin-top:10px"><div class="e" style="width:42.9%;background:#8a8a8a"></div><div class="e" style="width:35.7%;background:#b5b5b5"></div><div class="e" style="width:4.8%;background:#dcdcdc"></div><div class="e" style="width:16.6%;background:#5b6b8a"></div></div></div>
<div class="brow"><span class="bi">✓</span><span class="bc">18</span><span class="bt">הותאמו לחשבוניות קיימות<small>ספק + סכום + תאריך תואמים</small></span></div>
<div class="brow"><span class="bi">⚙</span><span class="bc">15</span><span class="bt">סווגו לפי כללים שלמדנו<small>ספקים שאישרת בעבר</small></span></div>
<div class="brow" style="opacity:.75"><span class="bi">⇄</span><span class="bc">2</span><span class="bt">העברות בין חשבונות שלך<small>הוסרו – לא נספרות ברווח</small></span></div>
<div class="brow" style="border:2px solid #5b6b8a;background:#eef0f5"><span class="bi" style="background:#5b6b8a;color:#fff;border-color:#5b6b8a">!</span><span class="bc" style="color:#2f3a52">7</span><span class="bt" style="font-weight:700;color:#2f3a52">ממתינות לאישור<small>ה-AI הציע שיוך – צריך את האישור שלך</small></span></div>
<div style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:#777;margin:4px 2px 12px"><span style="width:20px;height:20px;border-radius:50%;border:1.5px solid #aaa;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none">i</span>3 חשבוניות עדיין לא שולמו – לא נספרות ברווח ›</div>
<div class="btn pri" style="margin-bottom:8px">לאשר 7 פריטים</div>
<div class="btn sec" style="height:50px;font-size:16px">אשר את כל המסווגים (33)</div>
<div style="text-align:center;font-size:14px;color:#5b6b8a;font-weight:600;margin-top:10px">הצג את כל 42 השורות ›</div>
</div>''' + nav("")

SCREENS2 = [
 ("06-change-sheet","Change sheet","שינוי", phone(rev_inner, change_sheet), [
  "<b>Purpose:</b> fix a wrong AI suggestion in 2 taps: one project chip + one category chip, then <bdi dir=rtl>שמור ואשר</bdi>.",
  "Opened from <b>שינוי</b> on the review card (or tapping a chip). Top row repeats supplier + amount so the user knows what they’re fixing.",
  "<b>Project chips:</b> 3 active projects, then overhead <bdi dir=rtl>הוצאות כלליות</bdi>, then <bdi dir=rtl>+ פרויקט חדש</bdi> for inline create (name only).",
  "<b>Category chips:</b> the 7 fixed categories in the user’s order, then <bdi dir=rtl>+ קטגוריה חדשה</bdi>.",
  "<b>Remember toggle (on by default):</b> creates a supplier rule, so future invoices/bank rows from this supplier are auto-classified and won’t come back to the queue.",
  "<b>פצל בין פרויקטים:</b> split one invoice across sites, by amount or by %."]),
 ("07-categories","Categories settings","הגדרות › קטגוריות", phone(cat_inner), [
  "<b>Purpose:</b> light-touch category management. The 7 defaults are preloaded; most users never come here.",
  "<b>Tabs:</b> expenses <bdi dir=rtl>הוצאות</bdi> / income <bdi dir=rtl>הכנסות</bdi>. The income tab would hold <bdi dir=rtl>תקבול מלקוח</bdi> and <bdi dir=rtl>הכנסה אחרת</bdi>.",
  "<b>Drag handles (⋮⋮):</b> reorder; the top ones show first in the Change-sheet picker. Counts show how many transactions use each category.",
  "<b>Row menu (⋯, shown open):</b> rename, hide, merge into another category. Delete is only allowed when a category has no transactions; used ones can only be hidden or merged.",
  "<b><bdi dir=rtl>מוסתרות (1)</bdi>:</b> collapsed hidden categories, restorable.",
  "New categories can also be created inline from the Change sheet."]),
 ("08-upload-results","Upload results","דוח בנק הועלה", phone(up_inner), [
  "<b>Purpose:</b> show what happened to a bank/credit statement upload, and send the user only to what needs attention.",
  "<b>Cash basis:</b> a bank row is what makes money count in P&amp;L. Invoice photos are the supporting documents that get matched to bank rows.",
  "<b>Breakdown:</b> 18 matched to invoices + 15 by learned rules + 2 own-account transfers removed + 7 for review = 42.",
  "<b>Unpaid invoices (3):</b> invoices with no matching bank row stay out of P&amp;L until the payment appears, or they’re marked paid manually (e.g. cash).",
  "<b>Primary:</b> <bdi dir=rtl>לאשר 7 פריטים</bdi> → Review queue. <b>Secondary:</b> bulk-confirm the 33 auto-classified rows. Link to view all rows."]),
]

for fid, en, he, ph, notes in SCREENS2:
    nh = "".join(f'<div class="n">{n}</div>' for n in notes)
    body = f'<div class="wrap">{ph}<div class="notes"><h2>{fid[:2]} · {en}</h2><div class="he">{he}</div>{nh}</div></div>'
    (OUT / f"{fid}.html").write_text(page(body, 794, 920), encoding="utf-8")
cols = ""
for fid, en, he, ph, notes in SCREENS2:
    cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{fid[:2]} · {en} <span style="font-weight:400;color:#777">· {he}</span></div>{ph}<div class="notes" style="width:410px"><div class="n">{notes[0]}</div></div></div>'
ov2 = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">Example data · low-fi wireframe · POC · part 2</div>
<div style="position:absolute;top:18px;right:32px;font-size:14px;color:#777">Construction P&amp;L – mobile POC · Hebrew RTL · 390×844</div>
<div style="display:flex;gap:32px">{cols}</div></div>'''
(OUT / "overview-2.html").write_text(page(ov2, 1358, 1100), encoding="utf-8")
print("ok2")

# =================== BATCH 3 (v2: many projects) ===================
CSS += r"""
.kpis.v2 .kpi .v{font-size:17px}
.crow2{background:#fff;border:1.5px solid #d6d6d6;border-radius:12px;padding:8px 12px 9px;margin-bottom:6px}
.crow2 .top{display:flex;justify-content:space-between;align-items:center;font-size:15px}
.crow2 .name{font-weight:600;color:#333}
.crow2 .bar{height:8px;margin-top:6px}
.sortpill{display:flex;background:#e2e2e2;border-radius:9px;padding:2px;font-size:12px;font-weight:500}
.sortpill span{padding:3px 9px;border-radius:7px;color:#777}
.sortpill .on{background:#fff;color:#333;font-weight:700}
.prow{display:flex;align-items:center;gap:10px;height:44px;border-bottom:1px solid #eee;padding:0 4px;font-size:15px;color:#333}
.prow .code{font-size:12px;font-weight:700;color:#666;background:#ececec;border-radius:6px;padding:2px 6px;direction:ltr;flex:none}
.prow .pn{flex:1}
.prow .pm{font-size:11.5px;color:#aaa}
.radio{width:20px;height:20px;border-radius:50%;border:2px solid #bbb;flex:none}
.sug{font-size:11px;font-weight:700;color:#7a86a0;background:#eef0f5;border-radius:6px;padding:2px 6px}
.toggle.on2{width:54px;height:30px;border-radius:15px;background:#5b6b8a}
.toggle.on2::after{top:3px;left:3px;width:24px;height:24px}
.toggle.on2 .ck{position:absolute;right:9px;top:4px;color:#fff;font-size:15px;font-weight:700}
"""

def crow2(name, inc, exp, scale=300000):
    prof = inc - exp
    if prof >= 0:
        bar = f'<div class="e" style="width:{exp/scale*100:.1f}%"></div><div class="p" style="width:{prof/scale*100:.1f}%"></div>'
    else:
        bar = f'<div class="e" style="width:{inc/scale*100:.1f}%"></div><div class="n" style="width:{-prof/scale*100:.1f}%"></div>'
    return f'<div class="crow2"><div class="top"><span class="name">{name}</span>{num(prof,"pl")}</div><div class="bar">{bar}</div></div>'

top5 = [("בניין מגורים חולון",300000,220000),("וילה רעננה",180000,130000),('מגדל משרדים פ"ת',250000,210000),("בית פרטי כפר סבא",120000,90000),('שיפוץ דירה ת"א',60000,70000)]
OTH_INC, OTH_EXP, OVH = 400000, 330000, 60000
T_INC = sum(i for _,i,_ in top5) + OTH_INC
T_EXP = sum(e for _,_,e in top5) + OTH_EXP + OVH
assert (T_INC, T_EXP) == (1310000, 1110000)
home2_inner = f'''<div class="content">
<div class="topbar" style="margin-bottom:8px"><div><div class="title">שלום, יוסי</div><div class="sub">סיכום החברה · 17 פרויקטים פעילים · ספטמבר 2026</div></div><div class="iconbtn">☰</div></div>
<div class="seg" style="margin-bottom:8px"><div class="on" style="padding:7px 0">החודש</div><div style="padding:7px 0">מתחילת השנה</div></div>
<div class="kpis v2" style="margin-bottom:8px">
<div class="kpi"><div class="l">הכנסות</div><div class="v">{num(T_INC)}</div></div>
<div class="kpi"><div class="l">הוצאות</div><div class="v">{num(T_EXP)}</div></div>
<div class="kpi big"><div class="l">רווח/הפסד</div><div class="v">{num(T_INC-T_EXP,"pl")}</div></div>
</div>
<div class="banner" style="padding:9px 12px;margin-bottom:8px;font-size:15px"><span class="dot" style="width:26px;height:26px">7</span>7 פריטים ממתינים לאישור<span class="go">‹</span></div>
<div class="sect" style="margin:8px 2px 6px;align-items:center"><span>פרויקטים · 5 המובילים</span><div class="sortpill"><span class="on">לפי פעילות</span><span>הפסד קודם</span></div></div>
{"".join(crow2(*p) for p in top5)}
<div class="crow2" style="display:flex;justify-content:space-between;align-items:center;background:#f7f7f7;padding:11px 12px"><span style="font-weight:600;color:#555;font-size:15px">עוד 12 פרויקטים · <span class="num pos">₪{OTH_INC-OTH_EXP:,}</span> רווח</span><span style="color:#5b6b8a;font-size:18px">‹</span></div>
<div class="crow2" style="background:#f0f0f0;border-style:dashed;display:flex;justify-content:space-between;align-items:center;padding:11px 12px"><span><span class="name" style="font-size:15px">הוצאות כלליות</span> <span style="font-size:12px;color:#999">· תקורה</span></span>{num(-OVH)}</div>
</div>''' + nav("home")

plist = [("P-14",'מגדל משרדים פ"ת',"היום"),("P-09","וילה רעננה","אתמול"),("P-21","בית פרטי כפר סבא","לפני 3 ימים"),("P-03",'שיפוץ דירה ת"א',"לפני שבוע"),("P-17","גן יבנה – תוספת קומה","")]
prows = "".join(f'<div class="prow"><span class="radio"></span><span class="code">{c}</span><span class="pn">{n}</span><span class="pm">{m}</span></div>' for c,n,m in plist)
change2_sheet = f'''<div class="overlay"></div><div class="sheet" style="top:52px;padding:8px 16px 22px;display:flex;flex-direction:column">
<div class="grab" style="margin-bottom:10px"></div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
<div><div style="font-size:19px;font-weight:700;color:#222">שינוי שיוך</div><div style="font-size:13px;color:#888">חומרי בניין השרון בע״מ · 21/09</div></div>
<div style="font-size:20px;font-weight:800;color:#222">{num(8500)}</div></div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-weight:700;font-size:14px;color:#555">פרויקט</span><span class="sug">מוצע</span></div>
<div class="pick" style="gap:6px;margin-bottom:8px"><span class="pc sel" style="font-size:14px;padding:7px 11px">✦ בניין מגורים חולון</span><span class="pc" style="font-size:14px;padding:7px 11px">וילה רעננה <small style="color:#999;font-size:11px">· אחרון</small></span><span class="pc" style="font-size:14px;padding:7px 11px">מגדל משרדים פ"ת</span></div>
<div class="field" style="height:44px;margin-bottom:6px;font-size:15px"><span style="color:#999;margin-inline-end:8px">⌕</span>חיפוש פרויקט או קוד (P-12)…</div>
<div style="font-size:12.5px;color:#888;margin:2px 2px 0">כל הפרויקטים · לפי פעילות אחרונה (38)</div>
<div style="position:relative;height:176px;overflow:hidden;border-bottom:1px solid #eee">{prows}
<div style="position:absolute;left:0;right:0;bottom:0;height:52px;background:linear-gradient(rgba(255,255,255,0),#fff)"></div></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 2px 2px"><span style="font-size:14px;color:#5b6b8a;font-weight:600">+ פרויקט חדש</span><span style="font-size:14px;color:#5b6b8a;font-weight:600">⇆ פצל בין פרויקטים ›</span></div>
<div style="font-size:11.5px;color:#999;margin:2px 2px 10px">פרויקטים שהסתיימו מוסתרים – החיפוש מוצא אותם</div>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-weight:700;font-size:14px;color:#555">קטגוריה</span><span class="sug">מוצע</span></div>
<div class="pick" style="gap:6px;margin-bottom:10px"><span class="pc sel" style="font-size:14px;padding:7px 11px">✓ חומרים</span><span class="pc" style="font-size:14px;padding:7px 11px">ציוד והשכרה</span><span class="pc" style="font-size:14px;padding:7px 11px">הובלה</span><span class="pc add" style="font-size:14px;padding:7px 11px">עוד קטגוריות ›</span></div>
<div style="display:flex;align-items:center;gap:12px;background:#f3f4f7;border-radius:12px;padding:10px 12px;margin-bottom:12px">
<div style="flex:1"><div style="font-size:15px;font-weight:600;color:#333">לזכור לספק הזה <span style="font-size:12px;color:#5b6b8a;font-weight:700">· פעיל</span></div><div style="font-size:12px;color:#888">השרון → בניין מגורים חולון · חומרים</div></div><div class="toggle on2"><span class="ck">✓</span></div></div>
<div class="btn pri" style="margin-top:auto">שמור ואשר</div>
</div>'''

SCREENS3 = [
 ("01-home-v2","Home – many projects","בית · v2", phone(home2_inner), [
  "<b>Purpose:</b> same Home, scaled to ~40 projects (17 active this month). Compact rows: name, profit, bar.",
  "<b>Top 5 by activity this month</b> (most cash movement). Sort pill switches to <b>loss first</b> (<bdi dir=rtl>הפסד קודם</bdi>) to surface problem projects.",
  "<b>All the rest collapse</b> into one row with their combined profit; tap → Projects list.",
  "<b>Company totals always include everything:</b> top 5 + the 12 others + overhead. Example: income 910k+400k = 1,310k; expenses 720k+330k+60k = 1,110k; profit 200k.",
  "<b>Overhead</b> stays a separate row. Review banner and bottom nav unchanged."]),
 ("06-change-sheet-v2","Change sheet – scalable picker","שינוי · v2", phone(rev_inner, change2_sheet), [
  "<b>Purpose:</b> the same fix flow, but works the same with 5 or 50 projects.",
  "<b>Suggested chips (<bdi dir=rtl>מוצע</bdi>):</b> AI alternatives (✦) + recently used for this supplier (<bdi dir=rtl>אחרון</bdi>). Most corrections are 1 tap here.",
  "<b>Search:</b> 2–3 letters of the name or the project code (P-12).",
  "<b>List</b> sorted by recent activity, not A–Z; short and scrollable (fade = more).",
  "<b>Finished projects</b> are auto-hidden from the picker but kept in reports; search still finds them.",
  "<b>Category:</b> 3 suggestions + <bdi dir=rtl>עוד קטגוריות</bdi> (full list with search). Split link kept.",
  "<b>Remember toggle ON by default</b> → creates a supplier rule."]),
]
for fid, en, he, ph, notes in SCREENS3:
    nh = "".join(f'<div class="n">{n}</div>' for n in notes)
    body = f'<div class="wrap">{ph}<div class="notes"><h2>{fid[:2]} · {en}</h2><div class="he">{he}</div>{nh}</div></div>'
    (OUT / f"{fid}.html").write_text(page(body, 794, 920), encoding="utf-8")
cols = ""
for fid, en, he, ph, notes in SCREENS3:
    cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{fid[:2]} · {en}</div>{ph}<div class="notes" style="width:410px"><div class="n">{notes[0]}</div></div></div>'
ov3 = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">Example data · low-fi wireframe · v2 (~40 projects)</div>
<div style="display:flex;gap:32px">{cols}</div></div>'''
(OUT / "overview-3.html").write_text(page(ov3, 916, 1100), encoding="utf-8")
print("ok3")

# =================== BATCH 4 (auto-approve, Hapoalim) ===================
def must_replace(s, a, b):
    assert a in s, a[:60]
    return s.replace(a, b)

strip = '''<div style="display:flex;align-items:center;gap:8px;background:#eef3ee;border:1.5px solid #b9d1ba;border-radius:12px;padding:8px 10px;margin-bottom:10px;font-size:14px;color:#335a36">
<span style="width:22px;height:22px;border-radius:50%;background:#2e7d32;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:none">✓</span>
<span style="flex:1"><b>12 תנועות אושרו אוטומטית היום</b> · <span style="color:#5b6b8a;font-weight:600">צפייה ›</span></span>
<span style="color:#8aa58c;font-size:16px;padding:0 2px">✕</span></div>'''
rev2_inner = must_replace(rev_inner, '<div class="btn ghost">אשר הכל · 4 בביטחון גבוה</div>', '')
rev2_inner = must_replace(rev2_inner, '<div class="sub">מה שה-AI לא היה בטוח בו</div></div>', '<div class="sub">רק מה שה-AI לא היה בטוח בו</div></div>')
rev2_inner = must_replace(rev2_inner, '<div style="display:flex;gap:4px;margin-bottom:12px">', strip + '<div style="display:flex;gap:4px;margin-bottom:12px">')

up2_inner = f'''<div class="content">
<div class="topbar" style="margin-bottom:10px"><div><div class="title">דוח בנק הועלה</div><div class="sub"><span class="emo">📄</span> <bdi dir=ltr>פועלים_ספטמבר.xlsx</bdi> · <span class="num">01–30/09</span></div><div class="sub" style="font-size:12.5px">בנק הפועלים · חשבון <span class="num">12-345-678901</span></div></div><div class="iconbtn">✕</div></div>
<div class="card" style="text-align:center;padding:12px;margin-bottom:10px;border-width:2px;border-color:#bbb">
<div style="font-size:34px;font-weight:800;color:#222;line-height:1.1">42</div><div style="font-size:16px;color:#555">שורות נקלטו</div>
<div class="bar" style="height:12px;border-radius:6px;margin-top:10px"><div class="e" style="width:42.9%;background:#8a8a8a"></div><div class="e" style="width:35.7%;background:#b5b5b5"></div><div class="e" style="width:4.8%;background:#dcdcdc"></div><div class="e" style="width:16.6%;background:#5b6b8a"></div></div></div>
<div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#2e7d32;margin:2px 2px 6px">✓ אושרו אוטומטית (33)</div>
<div class="brow"><span class="bi">✓</span><span class="bc">18</span><span class="bt">הותאמו לחשבוניות קיימות<small>אושרו אוטומטית · ספק + סכום + תאריך תואמים</small></span></div>
<div class="brow"><span class="bi">⚙</span><span class="bc">15</span><span class="bt">סווגו לפי כללים שלמדנו<small>אושרו אוטומטית · ספקים שאישרת בעבר</small></span></div>
<div class="brow" style="opacity:.75"><span class="bi">⇄</span><span class="bc">2</span><span class="bt">העברות בין חשבונות שלך<small>הוסרו – לא נספרות ברווח</small></span></div>
<div class="brow" style="border:2px solid #5b6b8a;background:#eef0f5"><span class="bi" style="background:#5b6b8a;color:#fff;border-color:#5b6b8a">!</span><span class="bc" style="color:#2f3a52">7</span><span class="bt" style="font-weight:700;color:#2f3a52">ממתינות לאישור<small>ה-AI לא היה בטוח – צריך את האישור שלך</small></span></div>
<div style="display:flex;align-items:center;gap:8px;font-size:13.5px;color:#777;margin:4px 2px 12px"><span style="width:20px;height:20px;border-radius:50%;border:1.5px solid #aaa;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none">i</span>3 חשבוניות עדיין לא שולמו – לא נספרות ברווח ›</div>
<div class="btn pri">לאשר 7 פריטים</div>
<div style="text-align:center;font-size:14px;color:#5b6b8a;font-weight:600;margin-top:12px">הצג את כל 42 השורות ›</div>
</div>''' + nav("")

SCREENS4 = [
 ("03-review-v2","Review queue – auto-approve","לאישור · v2", phone(rev2_inner), [
  "<b>Purpose:</b> only uncertain items reach the queue. High-confidence items are auto-approved by default and never show up here.",
  "<b>Info strip:</b> “12 auto-approved today”, dismissible (✕). <b>צפייה ›</b> opens a list where any auto-approved item can be reopened and changed, so auto-approval is reversible.",
  "<b>Counter</b> (3 of 7) + progress bar unchanged.",
  "<b>One card at a time:</b> approve <bdi dir=rtl>אישור</bdi> (primary) · change <bdi dir=rtl>שינוי</bdi> · skip <bdi dir=rtl>דלג</bdi>. No bulk “approve all” anymore.",
  "<b>Remember hint:</b> after a change the app keeps a rule for that supplier.",
  "<b>Next in queue</b> preview shows what’s coming."]),
 ("08-upload-results-v2","Upload results – Hapoalim","דוח בנק הועלה · v2", phone(up2_inner), [
  "<b>Purpose:</b> summary after uploading a statement. The POC supports <b>Bank Hapoalim exports only</b>; other banks and credit cards come later.",
  "<b>Header:</b> file name + bank and account number, so the user sees which account was imported.",
  "<b>Auto-approved (33):</b> 18 matched to invoices + 15 by learned rules. Already in P&amp;L, reversible from the auto-approved list.",
  "<b>Transfers (2)</b> between own accounts are removed. <b>7 need review</b>: 33 + 2 + 7 = 42.",
  "<b>Cash basis:</b> a bank row is what makes money count. The 3 unpaid invoices stay out of P&amp;L until the payment appears or they’re marked paid.",
  "<b>Single action:</b> <bdi dir=rtl>לאשר 7 פריטים</bdi> → Review queue. Link to view all rows."]),
]
for fid, en, he, ph, notes in SCREENS4:
    nh = "".join(f'<div class="n">{n}</div>' for n in notes)
    body = f'<div class="wrap">{ph}<div class="notes"><h2>{fid[:2]} · {en}</h2><div class="he">{he}</div>{nh}</div></div>'
    (OUT / f"{fid}.html").write_text(page(body, 794, 920), encoding="utf-8")
cols = ""
for fid, en, he, ph, notes in SCREENS4:
    cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{fid[:2]} · {en}</div>{ph}<div class="notes" style="width:410px"><div class="n">{notes[0]}</div></div></div>'
ov4 = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">Example data · low-fi wireframe · v2 (auto-approve)</div>
<div style="display:flex;gap:32px">{cols}</div></div>'''
(OUT / "overview-4.html").write_text(page(ov4, 916, 1100), encoding="utf-8")
print("ok4")

# =================== BATCH 5 (Flow: onboarding, detail, split, unpaid, notifications, home v3) ===================
CSS += r"""
.step{display:flex;align-items:center;gap:6px;margin:4px 0 14px}
.step .d{flex:1;height:5px;border-radius:3px;background:#d8d8d8}
.step .d.on{background:#5b6b8a}
.step .t{font-size:12.5px;color:#888;margin-inline-start:6px;white-space:nowrap}
.h1{font-size:24px;font-weight:800;color:#222;margin-bottom:6px}
.para{font-size:14.5px;color:#777;line-height:1.45;margin-bottom:16px}
.logo{display:inline-flex;align-items:center;gap:8px;font-size:22px;font-weight:800;color:#333;direction:ltr}
.logo .m{width:40px;height:40px;border-radius:11px;background:#5b6b8a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px}
.codebox{display:flex;gap:8px;direction:ltr;justify-content:center;margin:10px 0}
.codebox div{width:46px;height:56px;border:1.5px solid #bbb;border-radius:10px;background:#fff;font-size:24px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#333}
.codebox div.cur{border:2px solid #5b6b8a}
.keys{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;direction:ltr;background:#d9d9d9;padding:8px 6px 26px;position:absolute;left:0;right:0;bottom:0}
.keys div{height:44px;background:#f4f4f4;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:20px;color:#444}
.cb{width:24px;height:24px;border-radius:6px;background:#5b6b8a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;flex:none}
.ostep{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px}
.ostep .k{width:28px;height:28px;border-radius:50%;border:2px solid #5b6b8a;color:#5b6b8a;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px;flex:none}
.ostep .x{font-size:15px;color:#444;line-height:1.4}
.ostep .x small{display:block;color:#999;font-size:12.5px}
.kv{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #eee;font-size:15px}
.kv:last-child{border-bottom:none}
.kv .k{color:#888;font-size:14px}.kv .v{color:#333;font-weight:600}
.stchip{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;border-radius:14px;padding:4px 10px;background:#e8f1e8;color:#2e6b31;border:1px solid #bcd6bd}
.stchip.g{background:#ececec;color:#555;border-color:#d0d0d0}
.act{display:flex;align-items:center;gap:10px;height:48px;font-size:16px;font-weight:600;color:#3e4a63;border-bottom:1px solid #eee}
.act:last-child{border-bottom:none}
.act .ai{width:30px;text-align:center;color:#888}
.delta{font-size:11.5px;font-weight:700;margin-top:1px}
.lock{position:absolute;inset:0;background:linear-gradient(170deg,#9a9a9a,#5e5e5e);direction:rtl}
.lock .tm{font-size:84px;font-weight:300;color:#fff;text-align:center;margin-top:80px;letter-spacing:-2px;direction:ltr}
.lock .dt{font-size:18px;color:#f0f0f0;text-align:center}
.notif{margin:40px 12px 0;background:rgba(245,245,245,.92);border-radius:20px;padding:12px 14px}
.notif .hd{display:flex;align-items:center;gap:8px;font-size:13px;color:#666;margin-bottom:6px}
.notif .ic{width:26px;height:26px;border-radius:7px;background:#5b6b8a;color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center}
.notif .ti{font-size:15.5px;font-weight:700;color:#222;margin-bottom:2px}
.notif .bd{font-size:15px;color:#333;line-height:1.35}
"""

def plain_phone(inner, extra=""):
    return f'<div class="phone"><div class="screen" style="background:#fff">{STATUS}{inner}</div>{extra}</div>'

def row_wide(items, title, label, w, h, fname, gap=32):
    cols = ""
    for ph, cap, note in items:
        cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{cap}</div>{ph}<div class="notes" style="width:410px">{note}</div></div>'
    body = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">{label}</div>
<div style="position:absolute;top:16px;right:32px;font-size:20px;font-weight:700;color:#333">{title}</div>
<div style="display:flex;gap:{gap}px">{cols}</div></div>'''
    (OUT / f"{fname}.html").write_text(page(body, w, h), encoding="utf-8")

# ---- 09 onboarding ----
ob_a = f'''<div class="content" style="padding-top:20px">
<div class="logo" style="margin-bottom:22px"><span class="m">F</span>Flow</div>
<div class="h1">כניסה</div><div class="para" style="margin-bottom:10px">רק מספר טלפון – בלי סיסמה.</div>
<div class="lbl">מספר טלפון</div>
<div class="field" style="color:#333;direction:ltr;justify-content:flex-end">050-123-4567</div>
<div class="btn pri" style="height:48px;opacity:.45;margin-bottom:18px">שלחו לי קוד</div>
<div style="font-size:15px;font-weight:700;color:#333">הזינו את הקוד שקיבלתם ב-SMS</div>
<div style="font-size:12.5px;color:#999">נשלח ל-<span class="num">050-123-4567</span></div>
<div class="codebox"><div>4</div><div>8</div><div>2</div><div>7</div><div class="cur"></div><div></div></div>
<div style="text-align:center;font-size:13px;color:#999">שליחה מחדש בעוד <span class="num">0:42</span></div>
</div>
<div class="keys">{"".join(f"<div>{k}</div>" for k in "123456789")}<div></div><div>0</div><div>⌫</div></div>'''

ob_b = '''<div class="content" style="padding-top:12px;display:flex;flex-direction:column">
<div class="step"><div class="d on"></div><div class="d"></div><div class="d"></div><div class="d"></div><span class="t">שלב 1 מתוך 4</span></div>
<div class="h1">פרטי החברה</div><div class="para">3 פרטים ומתחילים. אפשר לשנות אחר כך.</div>
<div class="lbl">שם החברה</div><div class="field focus">א.ב. בנייה ושיפוצים בע״מ</div>
<div class="lbl">ח.פ. / מספר עוסק</div><div class="field" style="color:#333"><span class="num">51-234567-8</span></div>
<div class="lbl">סוג העסק</div>
<div class="seg"><div class="on">חברה בע״מ</div><div>עוסק מורשה</div></div>
<div class="btn pri" style="margin-top:auto;margin-bottom:24px">המשך</div>
</div>'''

ob_c = '''<div class="content" style="padding-top:12px;display:flex;flex-direction:column">
<div class="step"><div class="d on"></div><div class="d on"></div><div class="d"></div><div class="d"></div><span class="t">שלב 2 מתוך 4</span></div>
<div class="h1">העלאת דוח פועלים</div><div class="para">מהדוח נבנה את הרווח וההפסד שלך. כך מייצאים:</div>
<div class="ostep"><span class="k">1</span><div class="x">באפליקציית פועלים: עו״ש › תנועות<small>בוחרים טווח תאריכים</small></div></div>
<div class="ostep"><span class="k">2</span><div class="x">ייצוא לאקסל › שמירה בקבצים<small>Files / הקבצים שלי</small></div></div>
<div class="ostep"><span class="k">3</span><div class="x">חוזרים לכאן ובוחרים את הקובץ</div></div>
<div class="ph" style="height:120px;margin:4px 0 14px">איור: מסך ייצוא בפועלים</div>
<div style="font-size:13px;color:#777;text-align:center;margin-bottom:10px">מומלץ: 3 החודשים האחרונים</div>
<div class="btn pri" style="height:62px;font-size:19px"><span class="emo">📄</span> בחר קובץ</div>
<div style="text-align:center;font-size:14px;color:#888;margin-top:12px">דלג לעכשיו</div>
</div>'''

def obproj(name, meta):
    return f'''<div class="row" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px"><span class="cb">✓</span>
<div style="flex:1"><div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1.5px dashed #ccc;padding-bottom:3px"><span class="name" style="font-size:15.5px">{name}</span><span style="color:#aaa;font-size:14px">✎</span></div><div class="meta" style="margin-top:4px">{meta}</div></div></div>'''
ob_d = f'''<div class="content" style="padding-top:12px;display:flex;flex-direction:column">
<div class="step"><div class="d on"></div><div class="d on"></div><div class="d on"></div><div class="d"></div><span class="t">שלב 3 מתוך 4</span></div>
<div class="h1">הפרויקטים שלך</div><div class="para" style="margin-bottom:12px">מצאנו לקוחות חוזרים בדוח – כנראה אלה הפרויקטים שלך. אפשר לשנות שם.</div>
{obproj("וילה רעננה", "משפ׳ כהן · 6 תקבולים · " + num(540000))}
{obproj("בניין מגורים חולון", "א.ב. נכסים · 4 תקבולים · " + num(900000))}
{obproj('שיפוץ דירה ת"א', "משפ׳ לוי · 3 תקבולים · " + num(120000))}
{obproj("בית פרטי כפר סבא", "י. מזרחי · 2 תקבולים · " + num(240000))}
<div style="font-size:15px;color:#5b6b8a;font-weight:600;margin:4px 2px">+ הוסף פרויקט</div>
<div class="btn pri" style="margin-top:auto;margin-bottom:24px">אשר והמשך</div>
</div>'''

ob_e = '''<div class="content" style="padding-top:12px;display:flex;flex-direction:column">
<div class="step"><div class="d on"></div><div class="d on"></div><div class="d on"></div><div class="d on"></div><span class="t">שלב 4 מתוך 4</span></div>
<div class="h1">התקנת Flow</div><div class="para" style="margin-bottom:10px">הוסיפו למסך הבית – נפתח כמו אפליקציה.</div>
<div class="card" style="display:flex;gap:10px;align-items:center;padding:10px;margin-bottom:12px">
<div style="flex:1;text-align:center"><div class="ph" style="height:66px;font-size:22px">⬆</div><div style="font-size:12.5px;color:#666;margin-top:4px">1. שיתוף בספארי</div></div>
<div style="color:#aaa">‹</div>
<div style="flex:1;text-align:center"><div class="ph" style="height:66px;font-size:12px;padding:4px">⊞ הוסף למסך הבית</div><div style="font-size:12.5px;color:#666;margin-top:4px">2. הוסף למסך הבית</div></div></div>
<div style="font-size:15px;font-weight:700;color:#333;margin-bottom:6px">שתי התראות בלבד:</div>
<div class="ostep" style="margin-bottom:8px"><span class="k" style="font-size:12px">א</span><div class="x">סיכום שבועי<small>ראשון 08:00 · רווח ומה חרג</small></div></div>
<div class="ostep" style="margin-bottom:12px"><span class="k" style="font-size:12px">ב</span><div class="x">תזכורת לאישור<small>18:00 · רק אם יש פריטים ממתינים</small></div></div>
<div class="btn sec" style="height:50px;margin-bottom:10px"><span class="emo">🔔</span> אפשר התראות</div>
<div class="btn pri" style="margin-top:auto;margin-bottom:24px">לדוח הרווח שלי</div>
</div>'''

N = lambda *xs: "".join(f'<div class="n">{x}</div>' for x in xs)
row_wide([
 (plain_phone(ob_a), "a · Sign-in · כניסה", N("<b>Phone + SMS code</b>, no password. Shown as two states: number entered (button used), then 6-digit code with numeric keypad and resend timer. Code auto-fills from SMS where supported.")),
 (plain_phone(ob_b), "b · Company · פרטי החברה", N("<b>Step 1/4.</b> Only 3 fields: company name, company/dealer number, business type (company vs licensed dealer). Everything editable later in settings.")),
 (plain_phone(ob_c), "c · Bank file · דוח פועלים", N("<b>Step 2/4.</b> 3 short steps to export from the Hapoalim app into Files. Big <bdi dir=rtl>בחר קובץ</bdi>; last 3 months recommended so the first P&amp;L is meaningful. Hapoalim only in the POC.")),
 (plain_phone(ob_d), "d · Projects · הפרויקטים שלך", N("<b>Step 3/4.</b> Suggested from recurring incoming payers in the bank file. Pre-checked, names editable inline (✎), uncheck to skip, + add another.")),
 (plain_phone(ob_e), "e · Install · התקנה", N("<b>Step 4/4.</b> PWA: add Flow to home screen (iPhone: Share › Add to Home Screen). Enable notifications, only two kinds (weekly summary, daily review reminder). CTA → first P&amp;L.")),
], "09 · Onboarding (first run) — goal: first P&amp;L within 15 minutes", "Example data · low-fi wireframe · Flow", 2274, 1180, "09-onboarding")

# ---- 10 transaction detail ----
def detail_inner(net, invno="10452", alloc="123456789", paid="23/09"):
    vat = int(net * 0.18); gross = net + vat
    return f'''<div class="content">
<div class="topbar" style="margin-bottom:8px"><div class="iconbtn">›</div><div class="sub" style="flex:1;margin-inline-start:10px;font-size:15px">הוצאה</div><div class="iconbtn">⋯</div></div>
<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:10px">
<div style="flex:1"><div style="font-size:20px;font-weight:800;color:#222">חומרי בניין השרון בע״מ</div>
<div style="font-size:30px;font-weight:800;color:#222;line-height:1.2">{num(net)}</div>
<div style="font-size:12.5px;color:#888">לפני מע״מ · מע״מ {num(vat)} · כולל {num(gross)}</div>
<div style="font-size:13px;color:#888;margin-top:2px">21/09/2026</div>
<div style="display:flex;gap:6px;margin-top:8px"><span class="stchip">✓ מאושר · אוטומטי</span><span class="stchip g">שולם</span></div></div>
<div style="text-align:center"><div class="ph" style="width:78px;height:100px">חשבונית</div><div style="font-size:11px;color:#999;margin-top:3px">הקישו להגדלה</div></div></div>
<div class="row" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:10px"><span class="emo" style="font-size:18px">🏦</span><div style="flex:1"><div style="font-size:15px;font-weight:600;color:#333">שולם {paid} · פועלים</div><div class="meta">שורת בנק מקושרת · {num(-gross)}</div></div><span style="color:#5b6b8a">‹</span></div>
<div class="card" style="padding:2px 12px;margin-bottom:10px">
<div class="kv"><span class="k">פרויקט</span><span class="v">בניין מגורים חולון <span style="color:#5b6b8a">‹</span></span></div>
<div class="kv"><span class="k">קטגוריה</span><span class="v">חומרים <span style="color:#5b6b8a">‹</span></span></div>
<div style="font-size:12.5px;color:#888;padding:0 0 9px">✦ למה? לפי כלל: חומרי בניין השרון ← חולון</div></div>
<div class="card" style="padding:2px 12px;margin-bottom:10px">
<div class="kv"><span class="k">מס׳ חשבונית</span><span class="v"><span class="num">{invno}</span></span></div>
<div class="kv"><span class="k">מספר הקצאה</span><span class="v"><span class="num">{alloc}</span></span></div></div>
<div class="card" style="padding:0 12px">
<div class="act"><span class="ai">⇆</span>פצל בין פרויקטים</div>
<div class="act"><span class="ai">↪</span>העבר לפרויקט אחר</div>
<div class="act" style="color:#c62828"><span class="ai" style="color:#c62828">🗑</span>מחק</div></div>
</div>'''

SCREENS5 = [
 ("10-transaction-detail","Transaction detail","פרטי הוצאה", plain_phone(detail_inner(8500)), [
  "<b>Purpose:</b> every number in reports is traceable to a document and/or a bank row. This is the bottom of that trail.",
  "<b>Header:</b> supplier, net amount (big), VAT + gross beneath, date. Status chips: approved · auto, paid.",
  "<b>Document thumbnail:</b> tap to enlarge (pinch to zoom).",
  "<b>Linked bank row</b> (paid 23/09 · Hapoalim) — tap to see the bank line. On cash basis this row is what puts it in P&amp;L.",
  "<b>Project / category rows:</b> tap to change → opens the Change sheet. <b>✦ Why</b> line explains the rule or AI reason.",
  "<b>Invoice no. + allocation no.</b> (מספר הקצאה, Israeli tax-authority invoice allocation number), for the accountant.",
  "<b>Actions:</b> split, move to another project, delete (red, asks for confirmation). Pushed screen: no bottom nav."]),
]

# ---- 11 split ----
def splitline(proj, amt, pct):
    return f'''<div class="card" style="padding:10px;margin-bottom:8px">
<div style="display:flex;gap:8px;margin-bottom:6px"><div class="field" style="flex:1;height:46px;margin:0;color:#333;justify-content:space-between">{proj}<span style="color:#999">⌄</span></div>
<div class="field" style="width:118px;height:46px;margin:0;color:#333;font-weight:700;justify-content:center"><span class="num">₪{amt:,}</span></div></div>
<div style="display:flex;justify-content:space-between;font-size:12.5px;color:#888;padding:0 2px"><span>קטגוריה: חומרים ⌄ <span style="color:#aaa">(כמו בחשבונית)</span></span><span class="num">{pct}%</span></div></div>'''
split_sheet = f'''<div class="overlay"></div><div class="sheet" style="padding-bottom:26px">
<div class="grab"></div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
<div><div style="font-size:19px;font-weight:700;color:#222">פיצול בין פרויקטים</div><div style="font-size:13px;color:#888">חומרי בניין השרון · חומרים</div></div>
<div style="font-size:20px;font-weight:800;color:#222">{num(12000)}</div></div>
<div class="seg"><div class="on">סכום</div><div>אחוזים</div></div>
{splitline("בניין מגורים חולון",7000,"58")}
{splitline("וילה רעננה",5000,"42")}
<div style="font-size:15px;color:#5b6b8a;font-weight:600;margin:4px 2px 12px">+ שורה</div>
<div style="display:flex;justify-content:space-between;align-items:center;background:#eef3ee;border:1.5px solid #b9d1ba;border-radius:12px;padding:11px 12px;margin-bottom:12px;font-size:15px"><span style="color:#335a36;font-weight:600">נותר לשייך</span><span class="pos" style="font-weight:800">✓ <span class="num">₪0</span></span></div>
<div class="btn pri">שמור פיצול</div>
</div>'''
SCREENS5.append(("11-split","Split sheet","פיצול", plain_phone(detail_inner(12000, "10988", "204315877", "24/09"), split_sheet), [
  "<b>Purpose:</b> divide one invoice across sites, e.g. ₪12,000 of materials delivered to two projects.",
  "<b>Toggle</b> amount / percent. Each line: project picker + amount (percent shown as helper).",
  "<b>Category per line</b> defaults to the invoice’s category; can be changed per line.",
  "<b>+ שורה</b> adds a line. <b>Live remainder:</b> green ₪0 when balanced. <b>Lines must sum to the total</b>; save stays disabled until they do:",
  '<div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;direction:rtl;font-size:13px"><div style="display:flex;justify-content:space-between;color:#c62828;font-weight:700;margin-bottom:6px"><span>נותר לשייך</span><span class="num">₪1,500</span></div><div style="background:#c9ccd4;color:#fff;border-radius:8px;text-align:center;padding:7px;font-weight:700">שמור פיצול</div></div><div style="font-size:12px;color:#777;margin-top:4px">Unbalanced state: red remainder, disabled save.</div>',
  "Opened from the Change sheet or Transaction detail."]))

# ---- 12 unpaid ----
def unpaid(sup, date, proj, amt, age, hl=False):
    st = "border:2px solid #5b6b8a" if hl else ""
    return f'''<div class="row" style="padding:10px 12px;{st}"><div class="top"><span class="name">{sup}</span><span class="num" style="font-weight:700">₪{amt:,}</span></div>
<div class="meta">{date} · {proj} · <b style="color:#777">{age}</b></div>
<div style="display:flex;justify-content:flex-end;margin-top:6px"><span style="font-size:14px;font-weight:700;color:#3e4a63;border:1.5px solid #5b6b8a;border-radius:10px;padding:5px 12px">✓ סמן כשולם</span></div></div>'''
unpaid_inner = f'''<div class="content">
<div class="topbar" style="margin-bottom:10px"><div class="iconbtn">›</div><div style="flex:1;margin-inline-start:10px"><div class="title" style="font-size:20px">חשבוניות שלא שולמו</div></div></div>
<div class="card" style="text-align:center;padding:12px;margin-bottom:10px;border-width:2px;border-color:#bbb"><div style="font-size:26px;font-weight:800;color:#222">{num(23400)}</div><div style="font-size:14px;color:#666">ממתין לתשלום · לא נכלל ברווח</div></div>
{unpaid("מ.ש. הובלות","02/09",'שיפוץ דירה ת"א',6000,"לפני 24 ימים")}
{unpaid("אבי חשמל","10/09","וילה רעננה",8000,"לפני 16 ימים")}
{unpaid("חומרי בניין השרון","14/09","בניין מגורים חולון",9400,"לפני 12 ימים", True)}
</div>''' + nav("")
paid_sheet = '''<div class="overlay"></div><div class="sheet">
<div class="grab"></div>
<div style="font-size:18px;font-weight:700;color:#222">סימון כשולם</div>
<div style="font-size:13px;color:#888;margin-bottom:12px">חומרי בניין השרון · <span class="num">₪9,400</span></div>
<div class="lbl">איך שולם?</div>
<div class="seg" style="margin-bottom:10px"><div>מזומן</div><div class="on">צ׳ק</div><div>אחר</div></div>
<div class="lbl">תאריך תשלום</div>
<div class="field" style="color:#333;justify-content:space-between">26/09/2026 <span class="emo" style="color:#999">📅</span></div>
<div class="btn pri" style="margin-top:4px">שמור</div>
</div>'''
SCREENS5.append(("12-unpaid","Unpaid invoices","חשבוניות שלא שולמו", plain_phone(unpaid_inner, paid_sheet), [
  "<b>Purpose:</b> invoices that have no matching bank payment yet. <b>Cash basis:</b> they count in P&amp;L only once paid.",
  "<b>Header total:</b> ₪23,400 waiting for payment, not included in profit.",
  "<b>Rows:</b> supplier, date, project, amount, age (oldest first).",
  "<b>סמן כשולם</b> opens a small sheet (shown open): cash / cheque / other + payment date. Saving moves it into P&amp;L on that date. If a matching bank row arrives later, it links automatically.",
  "<b>Entry points:</b> the “3 invoices not paid” line on Upload results, the light link on Home, and the Home menu (☰)."]))

# ---- 01 home v3 ----
home3_inner = must_replace(home2_inner, '<div class="seg" style="margin-bottom:8px"><div class="on" style="padding:7px 0">החודש</div><div style="padding:7px 0">מתחילת השנה</div></div>',
  '<div class="seg" style="margin-bottom:8px"><div class="on" style="padding:7px 0">החודש</div><div style="padding:7px 0">חודש קודם</div><div style="padding:7px 0">מתחילת השנה</div></div>')
for lbl, d in [("הכנסות",'<div class="delta pos"><span class="num">▲ 8%</span></div>'),("הוצאות",'<div class="delta neg"><span class="num">▲ 12%</span></div>'),("רווח/הפסד",'<div class="delta neg"><span class="num">▼ 10%</span></div>')]:
    import re as _re
    home3_inner = _re.sub(rf'(<div class="l">{lbl}</div><div class="v">.*?</span></div>)', lambda m: m.group(1) + d, home3_inner, count=1)
assert home3_inner.count('class="delta') == 3
home3_inner = must_replace(home3_inner, '7 פריטים ממתינים לאישור<span class="go">‹</span></div>',
  '7 פריטים ממתינים לאישור<span class="go">‹</span></div><div style="font-size:13px;color:#777;margin:-2px 4px 4px;display:flex;justify-content:space-between"><span>3 חשבוניות לא שולמו · <span class="num">₪23,400</span></span><span style="color:#5b6b8a">‹</span></div>')
home3_inner = must_replace(home3_inner, '<div class="topbar" style="margin-bottom:8px"><div><div class="title">שלום, יוסי</div>', '<div class="topbar" style="margin:0 0 6px"><div><div class="title" style="font-size:20px">שלום, יוסי</div>')
home3_inner = home3_inner.replace('class="crow2"><div class="top">', 'class="crow2" style="padding:6px 12px 7px;margin-bottom:5px"><div class="top">')
home3_inner = must_replace(home3_inner, '<div class="banner" style="padding:9px 12px;margin-bottom:8px;font-size:15px">', '<div class="banner" style="padding:7px 12px;margin-bottom:6px;font-size:15px">')
SCREENS5.append(("01-home-v3","Home v3 – compare + unpaid","בית · v3", phone(home3_inner), [
  "<b>Purpose:</b> Home v2 plus month-over-month context and a light path to unpaid invoices.",
  "<b>Period switcher</b> now has 3 options: this month / previous month / year to date.",
  "<b>Deltas vs previous month</b> under each big number. Colour = good/bad, not direction: income ▲ green, expenses ▲ red, profit ▼ red.",
  "<b>Unpaid line</b> under the review banner: 3 unpaid invoices · ₪23,400 → Unpaid list. Deliberately quiet (not part of profit).",
  "Top 5 + “12 more” + overhead unchanged; totals still include everything (1,310k − 1,110k = 200k)."]))

for fid, en, he, ph, notes in SCREENS5:
    nh = "".join(f'<div class="n">{n}</div>' for n in notes)
    body = f'<div class="wrap">{ph}<div class="notes"><h2>{fid[:2]} · {en}</h2><div class="he">{he}</div>{nh}</div></div>'
    (OUT / f"{fid}.html").write_text(page(body, 794, 920), encoding="utf-8")

# ---- 13 notifications ----
def lockphone(tm, dt, title, body):
    return f'''<div class="phone"><div class="lock"><div class="status" style="color:#eee"><span></span><div class="notch"></div><span>▮▮▮ ◔</span></div>
<div class="tm">{tm}</div><div class="dt">{dt}</div>
<div class="notif"><div class="hd"><span class="ic">F</span><span style="font-weight:700;color:#444">Flow</span><span style="margin-inline-start:auto">עכשיו</span></div>
<div class="ti">{title}</div><div class="bd">{body}</div></div>
<div style="position:absolute;bottom:40px;left:0;right:0;display:flex;justify-content:space-between;padding:0 40px"><span style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.25)"></span><span style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.25)"></span></div>
<div class="homeind" style="background:#eee"></div></div></div>'''
row_wide([
 (lockphone("08:00","יום ראשון, 27 בספטמבר","סיכום שבועי",'רווח <span class="num">₪42,000</span>. וילה רעננה חרגה ב-<span class="num">15%</span> מהתקציב'),
  "a · Weekly summary · Sunday 08:00", N("<b>Sent every Sunday at 08:00.</b> Last week’s profit + the single most important alert (e.g. a project over budget). Tap → opens Home.")),
 (lockphone("18:00","יום שלישי, 29 בספטמבר","7 תנועות מחכות לך","בערך 2 דקות"),
  "b · Review reminder · daily 18:00", N("<b>Max once a day at 18:00, only if items are waiting.</b> Shows count + time estimate to lower friction. Tap → opens Review.")),
], "13 · Notifications", "Example data · low-fi wireframe · Flow", 916, 1100, "13-notifications")

# ---- overview 5 ----
cols = ""
for fid, en, he, ph, notes in SCREENS5:
    cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{fid[:2]} · {en}</div>{ph}<div class="notes" style="width:410px"><div class="n">{notes[0]}</div></div></div>'
cols = cols  # order: 10, 11, 12, 01-home-v3
ov5 = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">Example data · low-fi wireframe · Flow</div>
<div style="display:flex;gap:32px">{cols}</div></div>'''
(OUT / "overview-5.html").write_text(page(ov5, 1800, 1100), encoding="utf-8")
print("ok5")

# ---- batch 6: shared costs / overhead view. Example data, September 2026. ----
# Overhead cost ₪60,000. Income shares rounded to ₪100; the ₪100 remainder goes to שיפוץ דירה ת"א.
SHARES = [
    ("בניין מגורים חולון", 80000, 13700),
    ("וילה רעננה", 50000, 8200),
    ('מגדל משרדים פ"ת', 40000, 11500),
    ("בית פרטי כפר סבא", 30000, 5500),
    ('שיפוץ דירה ת"א', -10000, 2800),
]
assert sum(s for _, _, s in SHARES) + 18300 == 60000

def crow4(name, before, share):
    after = before - share
    return f'''<div class="crow2" style="padding:6px 12px 6px;margin-bottom:5px"><div class="top"><span class="name">{name}</span>{num(after,"pl")}</div>
<div style="font-size:11.5px;color:#888;margin-top:1px">לפני {num(before)} · חלק {num(share)}</div></div>'''

home4_inner = f'''<div class="content">
<div class="topbar" style="margin:0 0 6px"><div><div class="title" style="font-size:20px">שלום, יוסי</div><div class="sub">סיכום החברה · 17 פרויקטים פעילים · ספטמבר 2026</div></div><div class="iconbtn">☰</div></div>
<div class="seg" style="margin-bottom:8px"><div class="on" style="padding:7px 0">החודש</div><div style="padding:7px 0">חודש קודם</div><div style="padding:7px 0">מתחילת השנה</div></div>
<div class="kpis v2" style="margin-bottom:8px">
<div class="kpi"><div class="l">הכנסות</div><div class="v">{num(1310000)}</div><div class="delta pos"><span class="num">▲ 8%</span></div></div>
<div class="kpi"><div class="l">הוצאות</div><div class="v">{num(1110000)}</div><div class="delta neg"><span class="num">▲ 12%</span></div></div>
<div class="kpi big"><div class="l">רווח/הפסד</div><div class="v">{num(200000,"pl")}</div><div class="delta neg"><span class="num">▼ 10%</span></div></div>
</div>
<div style="display:flex;align-items:center;gap:10px;background:#f3f4f7;border-radius:12px;padding:8px 12px;margin-bottom:6px">
<div style="flex:1;font-size:14px;font-weight:700;color:#333">רווח אחרי חלק מהתקורה</div><div class="toggle on2"><span class="ck">✓</span></div></div>
<div class="banner" style="padding:7px 12px;margin-bottom:6px;font-size:15px"><span class="dot" style="width:26px;height:26px">7</span>7 פריטים ממתינים לאישור<span class="go">‹</span></div>
<div style="font-size:13px;color:#777;margin:-2px 4px 4px;display:flex;justify-content:space-between"><span>3 חשבוניות לא שולמו · {num(23400)}</span><span style="color:#5b6b8a">‹</span></div>
<div class="sect" style="margin:6px 2px 6px;align-items:center"><span>פרויקטים · 5 המובילים</span><div class="sortpill"><span class="on">לפי פעילות</span><span>הפסד קודם</span></div></div>
{"".join(crow4(*p) for p in SHARES)}
<div class="crow2" style="padding:8px 12px;margin-bottom:5px;background:#f7f7f7"><div class="top"><span style="font-weight:600;color:#555;font-size:15px">עוד 12 פרויקטים</span>{num(51700,"pl")}</div>
<div style="font-size:11.5px;color:#888;margin-top:1px">לפני {num(70000)} · חלק {num(18300)}</div></div>
<div class="crow2" style="background:#ececec;border-style:dashed;padding:8px 12px;opacity:.55"><div class="top"><span class="name" style="font-size:15px;text-decoration:line-through;color:#777">הוצאות כלליות</span><span class="num" style="text-decoration:line-through;color:#777">−₪60,000</span></div>
<div style="font-size:11.5px;color:#888;margin-top:2px">חולק לפרויקטים בתצוגה הזו</div></div>
</div>''' + nav("home")

# Project v2. ₪40,000 share is example data for project-to-date, not the September Home share.
proj2_inner = proj_inner.replace(
    '<div class="kpi big"><div class="l">רווח · 20%</div><div class="v">' + num(180000, "pl") + '</div></div>\n</div>',
    '<div class="kpi big"><div class="l">רווח · 15.6%</div><div class="v">' + num(140000, "pl") + '</div></div>\n</div>'
    + '''<div style="display:flex;align-items:center;gap:10px;background:#f3f4f7;border-radius:12px;padding:8px 12px;margin:-4px 0 8px">
<div style="flex:1;font-size:14px;font-weight:700;color:#333">רווח אחרי חלק מהתקורה</div><div class="toggle on2"><span class="ck">✓</span></div></div>
<div class="card" style="margin-bottom:10px;padding:8px 12px">
<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0"><span style="color:#666">לפני</span>''' + num(180000) + '''</div>
<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;border-top:1px solid #eee"><span style="color:#666">חלק מהתקורה</span>''' + num(-40000) + '''</div>
<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;padding:6px 0;border-top:1px solid #eee"><span>אחרי</span>''' + num(140000, "pl") + '''</div>
<div style="font-size:11.5px;color:#888">תקורה × חלק מהכנסות החברה · מתחילת הפרויקט</div></div>''',
    1,
)

split2_sheet = f'''<div class="overlay"></div><div class="sheet" style="padding-bottom:18px">
<div class="grab"></div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
<div><div style="font-size:18px;font-weight:700;color:#222">פיצול בין פרויקטים</div><div style="font-size:12.5px;color:#888">חומרי בניין השרון · חומרים</div></div>
<div style="font-size:20px;font-weight:800;color:#222">{num(12000)}</div></div>
<div class="seg" style="margin-bottom:8px"><div style="padding:7px 0">שווה</div><div class="on" style="padding:7px 0">לפי הכנסה</div><div style="padding:7px 0">ידני</div></div>
<div class="btn sec" style="height:44px;margin-bottom:8px;font-size:15px">✓ כל הפרויקטים הפעילים</div>
{splitline("בניין מגורים חולון",2700,"23")}
{splitline("וילה רעננה",1600,"13")}
<div style="font-size:14px;color:#5b6b8a;font-weight:600;margin:0 2px 8px">עוד 15 פרויקטים · {num(7700)}</div>
<div style="display:flex;justify-content:space-between;align-items:center;background:#eef3ee;border:1.5px solid #b9d1ba;border-radius:12px;padding:10px 12px;margin-bottom:8px;font-size:14px"><span style="color:#335a36;font-weight:600">נותר לשייך</span><span class="pos" style="font-weight:800">✓ <span class="num">₪0</span> · <span class="num">100%</span></span></div>
<div style="display:flex;align-items:center;gap:10px;background:#f3f4f7;border-radius:12px;padding:8px 12px;margin-bottom:8px"><div style="flex:1;font-size:14px;font-weight:600;color:#333">פצל ככה כל חודש</div><div class="toggle on2"><span class="ck">✓</span></div></div>
<div class="btn pri">שמור פיצול</div>
</div>'''

SCREENS6 = [
 ("11-split-v2", "Split across active projects", "פיצול · v2", plain_phone(detail_inner(12000, "10988", "204315877", "24/09"), split2_sheet), [
  "<b>Example data.</b> Method: equal / by income (selected) / manual % or ₪.",
  "<b>One tap:</b> כל הפרויקטים הפעילים fills every active project.",
  "<b>Remainder</b> must reach ₪0 and 100% before save.",
  "<b>פצל ככה כל חודש</b> saves a recurring split rule. Income share recalculates each month."]),
 ("01-home-v4", "Home – after overhead share", "בית · v4", phone(home4_inner), [
  "<b>Example data.</b> Switch on: each row is profit after its overhead share, with a before · share subline. Bars hidden.",
  "<b>Overhead row</b> is grey and struck through: allocated in this view only. Company tiles stay ₪1,310,000 / ₪1,110,000 / ₪200,000.",
  "Shares round to ₪100. The ₪100 difference in this example sits on שיפוץ דירה ת״א so the shares sum to ₪60,000."]),
 ("02-project-v2", "Project – after overhead share", "פרויקט · v2", phone(proj2_inner), [
  "<b>Example data.</b> Same switch. Card: before ₪180,000, share −₪40,000, after ₪140,000.",
  "Share = company overhead × this project's share of company income since the project started. The ₪40,000 is an example, not the September Home share."]),
]
for fid, en, he, ph, notes in SCREENS6:
    nh = "".join(f'<div class="n">{n}</div>' for n in notes)
    body = f'<div class="wrap">{ph}<div class="notes"><h2>{fid[:2]} · {en}</h2><div class="he">{he}</div>{nh}</div></div>'
    (OUT / f"{fid}.html").write_text(page(body, 794, 920), encoding="utf-8")
cols = ""
for fid, en, he, ph, notes in SCREENS6:
    cols += f'<div style="display:flex;flex-direction:column;gap:12px;width:410px"><div style="font-size:18px;font-weight:700;color:#333">{fid[:2]} · {en}</div>{ph}<div class="notes" style="width:410px"><div class="n">{notes[0]}</div></div></div>'
ov6 = f'''<div style="position:relative;padding:60px 32px 32px"><div class="exlabel">Example data · low-fi wireframe · Flow</div>
<div style="display:flex;gap:32px">{cols}</div></div>'''
(OUT / "overview-6.html").write_text(page(ov6, 1358, 1100), encoding="utf-8")
print("ok6")
