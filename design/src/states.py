# Flow empty states (es-NN) and loaders (ld-NN), light + dark. Run: python3 states.py && bash render-states.sh
# Renders are static (class "still" freezes shimmer/spinners). Open an HTML file with #live to see the motion.
import pathlib
from flow import appic, ic, num, n, spin, sk, tabbar, doc, STATUS, EXTAG, topbar, home, review
OUT = pathlib.Path(__file__).parent
LIVE = '<script>if(location.hash=="#live")document.body.classList.remove("still")</script>'

def empty(icon, title, line, btn="", top=160, bottom=86):
    return f'''<div class="fillc" style="top:{top}px;bottom:{bottom}px"><div class="empty lg"><span class="eic">{ic(icon,36,1.6)}</span><div class="t2">{title}</div><div class="ln">{line}</div>{btn}</div></div>'''
def title_head(t, sub=""):
    return f'<div class="head" style="padding-top:0"><div class="t1">{t}</div>{f"<div class=lbl>{sub}</div>" if sub else ""}</div>'

ES, LD = {}, {}
def es(fid):
    def d(fn): ES[fid] = fn; return fn
    return d
def ld(fid):
    def d(fn): LD[fid] = fn; return fn
    return d

# ---------------- empty states ----------------
@es("es-01-home-first-run")
def es_home(mode):
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="hd"><span class="wm">Flow</span>{EXTAG}</div>
<div class="hero" style="padding-top:24px"><div class="t2">שלום, אלירן</div><div class="lbl" style="margin-top:2px">כאן יופיע הרווח הנקי של העסק</div></div></div>
{empty("chart","עוד אין נתונים","מעלים דוח Excel מאפליקציית פועלים, ובונים ממנו רווח והפסד תוך דקה.", f'<div class="btn pri">{ic("upload",20,2)}העלאת דוח בנק</div>', top=190)}
{tabbar("home", badge=0)}</div>'''

@es("es-02-project-empty")
def es_project(mode):
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="top"><span class="iconbtn">{ic("back",24,2)}</span><span style="display:flex;align-items:center">{EXTAG}<span class="iconbtn">{ic("more",24,2)}</span></span></div>
<div class="pad"><div class="t2">גן יבנה – תוספת קומה</div><div class="lbl">משפ׳ דהן · נפתח היום</div></div>
<div class="hero" style="padding-top:22px"><div class="lbl">רווח</div><div class="big" style="font-size:36px;line-height:1.2">{num(0)}</div></div></div>
{empty("doc","אין עדיין תנועות","חשבוניות ותשלומים של הפרויקט יופיעו כאן.", f'<div class="btn sec">{ic("camera",20,2)}צילום חשבונית</div>', top=330)}
{tabbar("proj", badge=0)}</div>'''

@es("es-03-review-done")
def es_review(mode):
    return f'''<div class="scr">{STATUS}{topbar(back=False)}{title_head("לאישור")}
{empty("checkc","הכל מאושר","אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש.", '<div class="btn sec">לדף הבית</div>', top=150)}
{tabbar("rev", badge=0)}</div>'''

@es("es-04-projects-none")
def es_projects(mode):
    return f'''<div class="scr">{STATUS}{topbar(back=False)}{title_head("פרויקטים")}
{empty("folder","עוד אין פרויקטים","פרויקטים נפתחים מעצמם כשמזהים לקוח חוזר בדוח הבנק. אפשר גם לפתוח ידנית.", f'<div class="btn pri">{ic("plus",20,2.4)}פרויקט חדש</div>', top=150)}
{tabbar("proj", badge=0)}</div>'''

@es("es-05-unpaid-none")
def es_unpaid(mode):
    return f'''<div class="scr">{STATUS}{topbar()}{title_head("חשבוניות פתוחות")}
{empty("checkc","הכל שולם","אין חשבוניות פתוחות כרגע.", top=150)}
{tabbar("home", badge=0)}</div>'''

@es("es-06-search-none")
def es_search(mode):
    return f'''<div class="scr">{STATUS}{topbar(back=False)}{title_head("פרויקטים")}
<div class="pad" style="margin-top:16px"><div class="inp search" style="box-shadow:inset 0 0 0 1.5px var(--accent)">{ic("search",20,2)}<span style="flex:1">גבעתיים</span><span style="color:var(--text-muted);display:grid">{ic("x",18,2)}</span></div></div>
{empty("search","לא מצאנו ״גבעתיים״","אפשר לחפש לפי שם פרויקט, לקוח או קוד. גם פרויקטים שהסתיימו נכללים.", '<div class="btn gho" style="width:auto;padding:0 20px">ניקוי החיפוש</div>', top=230)}
{tabbar("proj", badge=0)}</div>'''

@es("es-07-categories-income")
def es_cats(mode):
    return f'''<div class="scr">{STATUS}{topbar()}
<div class="head" style="padding-top:0"><div class="hint">הגדרות</div><div class="t1">קטגוריות</div></div>
<div class="pad" style="margin-top:16px"><div class="seg"><span>הוצאות</span><span class="on">הכנסות</span></div></div>
{empty("tag","אין קטגוריות הכנסה","כל ההכנסות נספרות כרגע כ״הכנסה מפרויקט״. צריך חלוקה נוספת? מוסיפים קטגוריה.", f'<div class="btn sec">{ic("plus",20,2.4)}קטגוריה חדשה</div>', top=250)}
{tabbar("set", badge=0)}</div>'''

@es("es-08-notifications-off")
def es_notif(mode):
    return f'''<div class="scr">{STATUS}{topbar()}
<div class="head" style="padding-top:0"><div class="hint">הגדרות</div><div class="t1">התראות</div></div>
{empty("belloff","אין התראות","ההתראות כבויות. נשלח רק שתיים: סיכום שבועי ותזכורת כשיש פריטים ממתינים.", f'<div class="btn pri">{ic("bell",20,2)}הפעלת התראות</div>', top=170)}
{tabbar("set", badge=0)}</div>'''

# ---------------- loaders ----------------
def sk_rows(k=3, sub=True, amt=True, widths=(150, 118, 170, 132, 104, 160)):
    out = ""
    for i in range(k):
        out += f'<div class="pr" style="padding:16px 0"><div style="display:flex;flex-direction:column;gap:8px">{sk(widths[i % len(widths)],14)}{sk(72,10) if sub else ""}</div>{sk(78,14) if amt else ""}</div>'
    return f'<div class="rows">{out}</div>'

@ld("ld-01-home-skeleton")
def ld_home(mode):
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="hd"><span class="wm">Flow</span><span class="per">החודש {ic("down",16,2.25)}</span></div>
<div class="gr" style="padding-top:10px">{sk(118,14)}{sk(96,10)}</div>
<div class="hero">{sk(120,14)}{sk(210,44,12,"margin-top:14px")}<div style="display:flex;gap:8px;margin-top:14px">{sk(64,22,11)}{sk(92,14,6,"margin-top:4px")}</div></div>
<div class="ie">{sk(120,14)}{sk(120,14)}</div></div>
<div class="card" style="margin-top:24px">{sk(22,22,11)}<div class="tx" style="display:flex;flex-direction:column;gap:8px">{sk(190,14)}{sk(140,10)}</div></div>
<div class="sec" style="padding-top:30px"><h2>פרויקטים מובילים</h2>{sk_rows(3)}</div>
{tabbar("home", badge=0)}</div>'''

@ld("ld-02-project-skeleton")
def ld_project(mode):
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="top"><span class="iconbtn">{ic("back",24,2)}</span><span class="iconbtn">{ic("more",24,2)}</span></div>
<div class="pad">{sk(170,24,8)}{sk(128,12,6,"margin-top:10px")}</div>
<div class="hero" style="padding-top:24px">{sk(110,14)}{sk(180,36,10,"margin-top:12px")}</div>
<div class="ie">{sk(120,14)}{sk(120,14)}</div></div>
<div class="pad" style="margin-top:24px;display:flex;align-items:center;gap:12px"><div style="flex:1;display:flex;flex-direction:column;gap:8px">{sk(180,14)}{sk(130,10)}</div>{sk(46,28,14)}</div>
<div class="sec" style="padding-top:30px">{sk(80,14)}{sk("100%",6,3,"margin-top:12px")}</div>
<div class="sec" style="padding-top:26px">{sk(150,14)}{sk_rows(3, sub=False)}</div>
{tabbar("proj", badge=0)}</div>'''

@ld("ld-03-list-skeleton")
def ld_list(mode):
    return f'''<div class="scr">{STATUS}{topbar(back=False)}
<div class="head" style="padding-top:0"><div class="t1">פרויקטים</div>{sk(160,12,6,"margin-top:10px")}</div>
<div class="pad" style="margin-top:16px"><div class="inp search">{ic("search",20,2)}<span class="ph">חיפוש פרויקט או לקוח</span></div></div>
<div class="pad" style="margin-top:8px">{sk_rows(6)}</div>
{tabbar("proj", badge=0)}</div>'''

@ld("ld-04-button-loading")
def ld_button(mode):
    h = review(mode)
    old = f'<div class="btn pri">{ic("check",20,2.4)}אישור</div><div style="display:flex;gap:8px"><div class="btn sec">שינוי</div><div class="btn gho">דלג</div></div>'
    assert old in h
    return h.replace(old, f'<div class="btn pri load">{spin(20,2.6)}מאשר…</div><div style="display:flex;gap:8px"><div class="btn dis">שינוי</div><div class="btn gho" style="color:var(--disabled-text)">דלג</div></div>')

@ld("ld-05-upload-processing")
def ld_upload(mode):
    steps = [("done", f"{n(42)} שורות נקלטו"), ("now", "מתאימים לחשבוניות ולפרויקטים"), ("wait", "מזהים העברות בין החשבונות שלך")]
    def st(s, t):
        dot = {"done": ic("check",18,2.6), "now": spin(18,2.6), "wait": '<i class="o"></i>'}[s]
        return f'<div class="rowi{" wait" if s=="wait" else ""}"><span class="dot">{dot}</span><div class="tx" style="{"color:var(--text-muted)" if s=="wait" else ""}">{t}</div></div>'
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="head" style="padding-top:0"><div class="t1">קוראים את הקובץ</div><div class="lbl"><bdi>פועלים_ספטמבר.xlsx</bdi></div></div>
<div class="pad" style="margin-top:40px;display:flex;justify-content:center"><div style="width:84px;height:100px;border-radius:14px;background:var(--tint);color:var(--accent-text);display:grid;place-items:center">{ic("doc",36,1.6)}</div></div>
<div class="pad" style="margin-top:36px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="lbl">שלב {n(2)} מתוך {n(3)}</span><span class="hint">{n("60%")}</span></div><div class="prog" style="margin-top:8px"><i style="width:60%"></i></div></div>
<div class="pad list steps" style="margin-top:14px">{"".join(st(s,t) for s,t in steps)}</div>
<div class="card" style="margin-top:20px;padding:12px 14px">{ic("clock",20,1.9)}<div class="tx" style="font-size:15px">זה לוקח בערך חצי דקה. אפשר לצאת – נודיע כשזה מוכן.</div></div>
<div class="acts" style="position:absolute;bottom:34px;inset-inline:0"><div class="btn sec">המשך ברקע</div></div></div>'''

@ld("ld-06-invoice-reading")
def ld_invoice(mode):
    lines = "".join(sk(w, 6, 3, "margin-top:9px") for w in (70, 96, 84, 60))
    paper = f'''<div style="width:150px;height:196px;border-radius:12px;background:var(--surface);border:1px solid var(--line);padding:18px 16px;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(20,10,40,.08)">
{sk(58,10,5)}{lines}<div style="border-top:1px solid var(--line);margin-top:18px"></div>{sk(90,8,4,"margin-top:12px")}{sk(50,12,5,"margin-top:10px")}
<div style="position:absolute;inset-inline:0;top:92px;height:2px;background:var(--accent);box-shadow:0 0 10px var(--accent)"></div></div>'''
    def fld(lbl, val):
        return f'<div class="pr" style="padding:12px 0"><span class="lbl">{lbl}</span>{val}</div>'
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="head" style="padding-top:0"><div class="t1">קוראים את החשבונית</div><div class="lbl">ספק, סכום, מע״מ ותאריך – עוד כמה שניות</div></div>
<div class="pad" style="margin-top:28px;display:flex;justify-content:center">{paper}</div>
<div class="pad rows" style="margin-top:24px">{fld("ספק", '<span style="display:flex;align-items:center;gap:6px">חומרי בניין השרון בע״מ<span class="acc">' + ic("check",16,2.6) + '</span></span>')}{fld("סכום", sk(84,14))}{fld("מע״מ", sk(64,14))}{fld("תאריך", sk(76,14))}</div>
<div class="pad" style="margin-top:16px;display:flex;align-items:center;gap:10px"><span class="acc">{spin(18,2.6)}</span><span class="lbl">מתאימים לפרויקט ולקטגוריה</span></div>
<div class="acts" style="position:absolute;bottom:34px;inset-inline:0"><div class="btn gho">ביטול</div></div></div>'''

@ld("ld-07-pull-to-refresh")
def ld_ptr(mode):
    h = home(mode)
    return h.replace('<div class="band">' + STATUS, f'<div class="band">{STATUS}<div class="ptr"><span>{spin(20,2.6)}</span></div>', 1)

@ld("ld-08-offline")
def ld_offline(mode):
    return f'''<div class="scr">{STATUS}{topbar(back=False)}
{empty("wifioff","אין חיבור לאינטרנט","בדקו את החיבור ונסו שוב. שום דבר לא נמחק.", f'<div class="btn pri">{ic("refresh",20,2)}ניסיון חוזר</div>', top=100)}
{tabbar("home", badge=0)}</div>'''

@ld("ld-09-offline-cached")
def ld_cached(mode):
    h = home(mode)
    ban = f'<div class="banner" style="margin-top:20px">{ic("wifioff",18,2)}<span>אין חיבור · נתונים מ-{n("09:12")}</span><span class="u">ניסיון חוזר</span></div>'
    old = '<div class="card" style="margin-top:24px">'
    assert old in h
    return h.replace(old, ban + '<div class="card" style="margin-top:12px">', 1)

ES_NAMES = ["בית · הפעלה ראשונה", "פרויקט בלי תנועות", "לאישור · הכל מאושר", "אין פרויקטים", "אין חשבוניות פתוחות", "חיפוש בלי תוצאות", "קטגוריות הכנסה", "התראות כבויות"]
LD_NAMES = ["בית · שלד", "פרויקט · שלד", "רשימה · שלד", "כפתור בטעינה", "קריאת דוח בנק", "קריאת חשבונית", "משיכה לרענון", "אין חיבור", "אין חיבור · נתונים שמורים"]

def build():
    for mode in ("light", "dark"):
        for d in (ES, LD):
            for fid, fn in d.items():
                html = doc(f"Flow · {fid} · {mode}", fn(mode), mode).replace("<body>", '<body class="still">', 1).replace("</body>", LIVE + "</body>")
                (OUT / f"{fid}-{mode}.html").write_text(html, encoding="utf-8")
        def row(d, names):
            return "".join(f'<div class="c"><div class="f"><iframe src="{fid}-{mode}.html" width="390" height="844" scrolling="no"></iframe></div><div class="cap"><span class="n">{fid[:5]}</span> · {nm}</div></div>' for fid, nm in zip(d, names))
        body = f'''<div class="hdr"><span class="wm logo" style="font-size:30px">Flow</span><span class="t2">מצבים ריקים וטעינה · {"מצב בהיר" if mode=="light" else "מצב כהה"}</span>{EXTAG}</div>
<div class="sh">מצבים ריקים</div><div class="g">{row(ES, ES_NAMES)}</div><div class="sh" style="margin-top:26px">טעינה ושגיאה</div><div class="g">{row(LD, LD_NAMES)}</div>'''
        (OUT / f"overview-states-{mode}.html").write_text(doc("Flow states overview", body, mode,
            "body{background:var(--tint);padding:28px 36px}.hdr{display:flex;gap:16px;align-items:baseline;margin-bottom:18px}.sh{font-size:17px;font-weight:600;margin-bottom:12px}.g{display:grid;grid-template-columns:repeat(9,205px);gap:18px}.f{width:205px;height:442px;border-radius:26px;overflow:hidden;border:5px solid #1D1728;background:var(--bg)}.f iframe{border:0;transform:scale(.5);transform-origin:top right;display:block}.cap{text-align:center;margin-top:8px;font-size:13px;color:var(--text-secondary)}", w=2080), encoding="utf-8")
if __name__ == "__main__":
    build()
