# Flow — remaining designs: date & period pickers, errors, install prompt, overhead ON, confirmation sheets.
# Run: python3 more.py && bash render-more.sh   (flow.py first: sheets sit over existing screens)
import pathlib, calendar
from flow import appic, ic, num, n, spin, tabbar, doc, STATUS, EXTAG, topbar, home, project, PROJ
OUT = pathlib.Path(__file__).parent
M = {}
def scr(fid):
    def d(fn): M[fid] = fn; return fn
    return d

HE_MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"]
WK = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"]
TODAY = (2026, 9, 26)

def calendar_html(y, m, sel=None, rng=None):
    """Sunday-first month grid, RTL (first column = Sunday on the right). sel=day, rng=(start,end)."""
    first = (calendar.weekday(y, m, 1) + 1) % 7   # Mon=0..Sun=6  ->  Sun=0..Sat=6
    days = calendar.monthrange(y, m)[1]
    cells = '<span class="d"></span>' * first
    for d in range(1, days + 1):
        cls = []
        future = (y, m, d) > TODAY
        if future: cls.append("off")
        if (y, m, d) == TODAY: cls.append("today")
        if sel == d: cls.append("sel")
        if rng:
            a, b = rng
            if d == a: cls += ["sel", "rs"]
            elif d == b: cls += ["sel", "re"]
            elif a < d < b: cls.append("mid")
        cells += f'<span class="d {" ".join(cls)}"><b>{d}</b></span>'
    nxt_off = (y, m) >= TODAY[:2]
    head = f'''<div class="calh"><span class="iconbtn" aria-label="חודש קודם">{ic("back",22,2)}</span><span class="t3">{HE_MONTHS[m-1]} {n(y)}</span><span class="iconbtn{" off" if nxt_off else ""}" aria-label="חודש הבא">{ic("chev",22,2)}</span></div>'''
    return head + '<div class="wk">' + "".join(f"<span>{w}</span>" for w in WK) + f'</div><div class="days">{cells}</div>'

def sheet(mode, under, body, top=None, pb=34):
    st = f"top:{top}px;" if top else ""
    return f'''<div class="scr"><iframe class="under" src="{under}-{mode}.html" scrolling="no"></iframe><div class="scrim"></div>
<div class="sheet" style="{st}padding-bottom:{pb}px"><div class="grab"></div>{body}</div></div>'''
def shd(title, sub=""):
    return f'''<div class="shd"><div><div class="t2">{title}</div>{f'<div class="lbl">{sub}</div>' if sub else ""}</div><span class="iconbtn" style="margin-block-start:-6px;margin-inline-start:-12px">{ic("x",22,2)}</span></div>'''
def bottom(btns):
    return f'<div class="acts" style="position:absolute;bottom:34px;inset-inline:0">{btns}</div>'
def fld(label, inner, cls=""):
    return f'<div class="fld"><label>{label}</label><div class="inp {cls}">{inner}</div></div>'
def endic(name):
    return f'<span style="margin-inline-start:auto;color:var(--text-muted);display:grid">{ic(name,20,2)}</span>'
def centre(inner, top, bottom_px=140):
    return f'<div class="fillc" style="top:{top}px;bottom:{bottom_px}px">{inner}</div>'

# ---------------- 15 date picker ----------------
def manual_form(toast=""):
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="head" style="padding-top:0"><div class="t1">הזנה ידנית</div><div class="lbl">רק כשאין חשבונית או שורת בנק</div></div>
<div class="pad" style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
{fld("סכום לפני מע״מ", f'<span class="n">₪1,200</span>')}
{fld("ספק", "מ.ש. הובלות")}
{fld("תאריך", f'<span class="n">21/09/2026</span>{endic("cal")}')}
{fld("פרויקט", f'וילה רעננה{endic("down")}')}
{fld("קטגוריה", f'הובלה{endic("down")}')}</div>
{toast}{bottom('<div class="btn pri">שמירה</div>')}</div>'''

@scr("15a-date-field")
def date_field(mode): return manual_form()

@scr("15b-date-single")
def date_single(mode):
    body = f'''{shd("תאריך ההוצאה")}
<div class="pad chips" style="margin-top:14px"><span class="chip">היום</span><span class="chip">אתמול</span></div>
<div style="margin-top:14px">{calendar_html(2026, 9, sel=21)}</div>
<div class="pad" style="margin-top:14px;text-align:center"><span class="lbl">יום שני, {n(21)} בספטמבר {n(2026)}</span></div>'''
    return sheet(mode, "15a-date-field", body + bottom('<div class="btn pri">בחירה</div>'), top=262)

@scr("15c-date-range")
def date_range(mode):
    body = f'''{shd("טווח מותאם")}
<div class="pad chips" style="margin-top:14px"><span class="chip">החודש</span><span class="chip">חודש קודם</span><span class="chip">מתחילת השנה</span></div>
<div class="pad" style="margin-top:16px;display:flex;gap:12px"><div style="flex:1">{fld("מתאריך", f'<span class="n">07/09/2026</span>')}</div><div style="flex:1">{fld("עד תאריך", f'<span class="n">18/09/2026</span>', "focus")}</div></div>
<div style="margin-top:12px">{calendar_html(2026, 9, rng=(7, 18))}</div>'''
    return sheet(mode, "01-home", body + bottom(f'<div class="btn pri"><span>הצגת {n(12)} ימים</span></div>'), top=196)

# ---------------- 16 period sheet ----------------
@scr("16-period-sheet")
def period(mode):
    def o(t, h, on=False):
        return f'<div class="opt"><div class="tx"><div>{t}</div><div class="hint">{h}</div></div><span class="rd{" on" if on else ""}">{ic("check",14,2.8) if on else ""}</span></div>'
    body = f'''{shd("תקופה")}
<div class="pad list" style="margin-top:8px">{o("החודש", f"ספטמבר {n(2026)}", True)}{o("חודש קודם", f"אוגוסט {n(2026)}")}{o("מתחילת השנה", f"ינואר–ספטמבר {n(2026)}")}
<div class="opt"><span class="acc" style="display:grid">{ic("cal",22,1.9)}</span><div class="tx"><div>טווח מותאם</div><div class="hint">בחירת תאריכים בלוח</div></div><span class="cv" style="color:var(--text-muted);display:grid">{ic("chev",20,2)}</span></div></div>'''
    return sheet(mode, "01-home", body)

# ---------------- 17 install prompt ----------------
@scr("17a-install-android")
def inst_android(mode):
    rows = [("home","פתיחה במגע אחד","מסך הבית, במסך מלא"),("bell","שתי התראות בלבד","סיכום שבועי ותזכורת לאישור"),("download","בלי חנות אפליקציות","מתעדכן לבד")]
    rr = "".join(f'<div class="rowi">{ic(i,22,1.9,"acc")}<div class="tx"><div>{t}</div><div class="hint">{h}</div></div></div>' for i, t, h in rows)
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="pad" style="margin-top:28px;display:flex;flex-direction:column;align-items:center;text-align:center">{appic()}<div class="t1" style="margin-top:20px">התקנת Flow</div><div class="lbl" style="margin-top:4px">נפתח כמו אפליקציה, ישר ממסך הבית.</div></div>
<div class="pad list" style="margin-top:28px">{rr}</div>
{bottom('<div class="btn pri">' + ic("download",20,2) + 'התקנה</div><div class="btn gho" style="height:44px;color:var(--text-secondary)">לא עכשיו</div>')}</div>'''

@scr("17b-install-iphone")
def inst_iphone(mode):
    steps = [f'מקישים על {("<span class=tile>" + ic("share",18,2) + "</span>")} <b style="font-weight:600">״שיתוף״</b> בסרגל של ספארי',
             f'בוחרים {("<span class=tile>" + ic("addsq",18,2) + "</span>")} <b style="font-weight:600">״הוסף למסך הבית״</b>',
             'מקישים <b style="font-weight:600">״הוסף״</b> בפינה העליונה']
    st = "".join(f'<div style="display:flex;gap:14px;align-items:center;padding:12px 0;{"border-top:1px solid var(--line);" if i else ""}"><span class="stepn n">{i+1}</span><span style="line-height:2">{s}</span></div>' for i, s in enumerate(steps))
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="pad" style="margin-top:28px;display:flex;flex-direction:column;align-items:center;text-align:center">{appic()}<div class="t1" style="margin-top:20px">הוספה למסך הבית</div><div class="lbl" style="margin-top:4px">באייפון זה נעשה מספארי, בשלושה צעדים.</div></div>
<div class="pad" style="margin-top:24px">{st}</div>
<div style="position:absolute;bottom:112px;inset-inline:0;display:flex;flex-direction:column;align-items:center;gap:2px" class="hint"><span>כפתור השיתוף נמצא למטה</span><span style="color:var(--accent-text);display:grid">{ic("down",22,2)}</span></div>
{bottom('<div class="btn sec">הבנתי</div>')}</div>'''

# ---------------- 18 / 19 overhead ON ----------------
@scr("18-home-overhead-on")
def home_on(mode):
    h = home(mode)
    import re
    h = re.sub(r'<div class="ie lbl">.*?</div></div>', f'<div class="ie lbl"><span>לפני כלליות<b>{num(260000)}</b></span><span>כלליות<b>{num(-60000)}</b></span></div></div>', h, count=1, flags=re.S)
    after = [("בניין מגורים חולון", 66300, "22%"), ("וילה רעננה", 41800, "23%"), ('מגדל משרדים פ"ת', 28500, "11%")]
    rows = "".join(f'<div class="pr"><div><div class="nm">{nm}</div><div class="hint">רווחיות {n(p)}</div></div><div class="amt">{num(v)}</div></div>' for nm, v, p in after)
    h = re.sub(r'<div class="sec"><h2>פרויקטים מובילים</h2>.*?<div class="lnk q"', f'<div class="sec"><div class="sechd"><h2>פרויקטים מובילים</h2><span class="hint">אחרי חלק בכלליות</span></div>{rows}<div class="lnk q"', h, count=1, flags=re.S)
    return h

@scr("19-project-overhead-on")
def project_on(mode):
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="top"><span class="iconbtn">{ic("back",24,2)}</span><span style="display:flex;align-items:center">{EXTAG}<span class="iconbtn">{ic("more",24,2)}</span></span></div>
<div class="pad"><div class="t2">וילה רעננה</div><div class="lbl">משפ׳ כהן · מתחילת הפרויקט</div></div>
<div class="hero" style="padding-top:22px"><div class="lbl">רווח אחרי כלליות · רווחיות {n("16%")}</div><div class="big" style="font-size:36px;line-height:1.2">{num(142200)}</div></div>
<div class="ie lbl"><span>הכנסות<b>{num(900000)}</b></span><span>הוצאות<b>{num(720000)}</b></span></div></div>
<div class="pad" style="margin-top:20px;display:flex;align-items:center;gap:12px"><div style="flex:1"><div>אחרי חלק בהוצאות כלליות</div><div class="hint">פועל · לפי חלק הפרויקט בהכנסות</div></div><span class="sw on"><i></i></span></div>
<div class="sec bk"><h2>איך מחושב</h2>
<div class="pr"><div class="nm">רווח לפני כלליות</div><div class="amt">{num(180000)}</div></div>
<div class="pr" style="border-top:1px solid var(--line)"><div><div class="nm">חלק בהוצאות הכלליות</div><div class="hint">{n("21%")} מההכנסות של כל הפרויקטים</div></div><div class="amt">{num(-37800)}</div></div>
<div class="pr tot"><div class="nm">רווח אחרי כלליות</div><div class="amt">{num(142200)}</div></div></div>
<div class="pad" style="display:flex;justify-content:space-between;margin-top:4px"><span class="lnk q">הוצאות לפי קטגוריה {ic("chev",16,2)}</span><span class="lnk">תנועות אחרונות {ic("chev",16,2)}</span></div>
{tabbar("proj")}</div>'''

# ---------------- 20–23 confirmation sheets ----------------
def confirm(mode, under, title, sub, line, primary, extra=""):
    body = f'''{shd(title, sub)}<div class="pad" style="margin-top:10px"><div style="font-size:15px;color:var(--text-secondary);font-weight:400">{line}</div>{extra}</div>
<div class="acts" style="margin-top:24px">{primary}<div class="btn gho" style="height:44px;color:var(--text-secondary)">ביטול</div></div>'''
    return sheet(mode, under, body)

@scr("20-confirm-delete")
def c_delete(mode):
    return confirm(mode, "10-transaction-detail", "למחוק את ההוצאה?", f"חומרי בניין השרון · {num(8500)}",
        "היא תוסר מהרווח של בניין מגורים חולון. אחרי המחיקה אפשר עוד לבטל לכמה שניות.", f'<div class="btn dngs">{ic("trash",20,2)}מחיקה</div>')

@scr("21-confirm-archive")
def c_archive(mode):
    return confirm(mode, "02-project", "להעביר לארכיון?", "וילה רעננה",
        "הפרויקט יוסר מהבית ומהרשימות. כל הנתונים נשמרים, ואפשר להחזיר אותו מתי שרוצים.", '<div class="btn pri">העברה לארכיון</div>')

CATS = [("חומרים",124),("קבלני משנה",38),("עבודה",52),("ציוד והשכרה",17),("ביטוח",4),("אחר",9)]
@scr("22a-merge-pick")
def merge_pick(mode):
    opts = "".join(f'<div class="opt" style="padding:12px 0"><div class="tx">{c}</div><span class="hint">{n(k)} תנועות</span><span class="rd{" on" if c=="ציוד והשכרה" else ""}">{ic("check",14,2.8) if c=="ציוד והשכרה" else ""}</span></div>' for c, k in CATS)
    body = f'''{shd("מיזוג ״הובלה״", f"לאן להעביר את {n(21)} התנועות?")}
<div class="pad" style="margin-top:6px"><span class="hint">שלב {n(1)} מתוך {n(2)}</span></div>
<div class="pad list" style="margin-top:4px">{opts}</div>
<div class="acts" style="margin-top:20px"><div class="btn pri">המשך</div></div>'''
    return sheet(mode, "07-categories", body)

@scr("22b-merge-confirm")
def merge_confirm(mode):
    vis = f'''<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:24px"><span class="chip"><span>הובלה · {n(21)}</span></span><span style="color:var(--text-muted);display:grid">{ic("move",20,2)}</span><span class="chip on">ציוד והשכרה</span></div>
<div class="t3" style="text-align:center;margin-top:20px"><span>{n(21)} תנועות יעברו ל״ציוד והשכרה״</span></div>
<div class="list" style="margin-top:14px"><div class="rowi" style="padding:10px 0">{ic("check",18,2.4,"acc")}<div class="tx" style="font-size:15px">״הובלה״ תוסר מרשימת הקטגוריות</div></div>
<div class="rowi" style="padding:10px 0">{ic("check",18,2.4,"acc")}<div class="tx" style="font-size:15px">הובלות חדשות ישויכו מעכשיו ל״ציוד והשכרה״</div></div></div>'''
    body = f'''{shd("מיזוג ״הובלה״", f"שלב {n(2)} מתוך {n(2)}")}<div class="pad">{vis}</div>
<div class="acts" style="margin-top:24px"><div class="btn pri">מיזוג</div><div class="btn gho" style="height:44px;color:var(--text-secondary)">חזרה</div></div>'''
    return sheet(mode, "07-categories", body)

@scr("23-confirm-hide")
def c_hide(mode):
    return confirm(mode, "07-categories", "להסתיר את ״ביטוח״?", f"{n(4)} תנועות",
        "היא לא תוצע יותר לתנועות חדשות. התנועות שכבר בה נשארות כמו שהן, ואפשר להחזיר אותה מ״מוסתרות״.", '<div class="btn pri">הסתרה</div>')

# ---------------- errors ----------------
def err_block(icon, title, line, btn, extra_top="", link=""):
    return f'''<div class="empty lg">{extra_top}<span class="eic">{ic(icon,36,1.6)}</span><div class="t2">{title}</div><div class="ln">{line}</div>{btn}{link}</div>'''

@scr("er-01-bank-file")
def er_bank(mode):
    chip = f'<span class="filechip" style="margin-bottom:24px">{ic("doc",18,1.9)}<bdi>קבלות_ספטמבר.pdf</bdi></span>'
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
{centre(err_block("upload","זה לא דוח מפועלים","צריך קובץ Excel שיוצא מאפליקציית בנק הפועלים. שום דבר לא השתנה בנתונים.",
  '<div class="btn pri">' + ic("doc",20,2) + 'בחירת קובץ אחר</div>', extra_top=chip, link='<span class="lnk q" style="margin-top:14px">איך מייצאים מפועלים? ' + ic("chev",16,2) + '</span>').replace('<span class="eic">' + ic("upload",36,1.6) + '</span>', ''), 60, 60)}</div>'''

@scr("er-02-invoice-blurry")
def er_invoice(mode):
    lines = "".join(f'<i style="display:block;height:6px;border-radius:3px;background:var(--text-muted);opacity:.5;margin-top:9px;width:{w}px"></i>' for w in (70, 96, 84, 60))
    paper = f'''<div style="width:120px;height:156px;border-radius:12px;background:var(--surface);border:1px solid var(--line);padding:16px 14px;margin-bottom:24px;overflow:hidden;box-shadow:0 2px 8px rgba(20,10,40,.08)"><div style="filter:blur(2.2px)"><i style="display:block;height:10px;width:50px;border-radius:5px;background:var(--text-secondary);opacity:.6"></i>{lines}</div></div>'''
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
{centre(err_block("camera","החשבונית לא ברורה","לא הצלחנו לקרוא סכום ותאריך. כדאי לצלם באור טוב, כשהחשבונית שטוחה וממלאת את המסך.",
  '<div class="btn pri">' + ic("camera",20,2) + 'צילום מחדש</div>', extra_top=paper, link='<span class="lnk q" style="margin-top:14px">הזנה ידנית ' + ic("chev",16,2) + '</span>').replace('<span class="eic">' + ic("camera",36,1.6) + '</span>', ''), 60, 60)}</div>'''

def sms(mode, digits, cls, msg, act):
    boxes = "".join(f'<span class="n">{d}</span>' for d in digits)
    return f'''<div class="scr">{STATUS}{topbar()}
<div class="head" style="margin-top:24px"><div class="t1">הקוד מה-SMS</div><div class="lbl">נשלח ל-{n("050-123-4567")}</div></div>
<div class="pad" style="margin-top:36px"><div class="code {cls}">{boxes}</div><div style="margin-top:14px;display:flex;justify-content:center">{msg}</div></div>
{act}</div>'''

@scr("er-03-sms-wrong")
def er_sms_wrong(mode):
    return sms(mode, "482917", "err", f'<span class="msg-e">{ic("info",16,2)}<span>הקוד לא נכון. אפשר לנסות שוב.</span></span>',
        f'<div class="pad" style="margin-top:28px;text-align:center"><span class="hint">שליחת קוד חדש בעוד {n("0:42")}</span></div>' + bottom('<div class="btn dis">אימות</div>'))

@scr("er-04-sms-expired")
def er_sms_expired(mode):
    return sms(mode, "      ", "", f'<span class="lbl" style="display:flex;gap:6px;align-items:center"><span style="color:var(--text-muted);display:grid">{ic("clock",18,2)}</span>הקוד כבר לא בתוקף – הוא פג אחרי {n(10)} דקות.</span>',
        bottom(f'<div class="btn pri">{ic("refresh",20,2)}שליחת קוד חדש</div>'))

@scr("er-05-save-failed")
def er_save(mode):
    toast = f'<div style="position:absolute;bottom:104px;inset-inline:16px"><div class="toast"><span style="color:var(--toast-bad);display:grid">{ic("info",18,2.2)}</span><span>לא נשמר – אין חיבור</span><span class="u">ניסיון חוזר</span></div></div>'
    return manual_form(toast)

ORDER = [("15a-date-field","15א שדה תאריך"),("15b-date-single","15ב בחירת תאריך"),("15c-date-range","15ג טווח מותאם"),("16-period-sheet","16 תקופה"),("17a-install-android","17א התקנה · אנדרואיד"),("17b-install-iphone","17ב התקנה · אייפון"),("18-home-overhead-on","18 בית · אחרי כלליות"),("19-project-overhead-on","19 פרויקט · אחרי כלליות"),("10-transaction-detail","10 פרטי הוצאה (מעודכן)"),
         ("20-confirm-delete","20 מחיקה"),("21-confirm-archive","21 ארכיון"),("22a-merge-pick","22א מיזוג · יעד"),("22b-merge-confirm","22ב מיזוג · אישור"),("23-confirm-hide","23 הסתרה"),("er-01-bank-file","er-01 קובץ בנק"),("er-02-invoice-blurry","er-02 חשבונית לא ברורה"),("er-03-sms-wrong","er-03 קוד שגוי"),("er-04-sms-expired","er-04 קוד פג"),("er-05-save-failed","er-05 שמירה נכשלה")]
def build():
    for mode in ("light", "dark"):
        for fid, fn in M.items():
            (OUT / f"{fid}-{mode}.html").write_text(doc(f"Flow · {fid} · {mode}", fn(mode), mode), encoding="utf-8")
        cell = lambda fid, nm: f'<div class="c"><div class="f"><iframe src="{fid}-{mode}.html" width="390" height="844" scrolling="no"></iframe></div><div class="cap">{nm}</div></div>'
        body = f'''<div class="hdr"><span class="wm logo" style="font-size:30px">Flow</span><span class="t2">מסכים נוספים · {"מצב בהיר" if mode=="light" else "מצב כהה"}</span>{EXTAG}</div>
<div class="g">{"".join(cell(f, nm) for f, nm in ORDER[:9])}</div><div class="g" style="margin-top:26px">{"".join(cell(f, nm) for f, nm in ORDER[9:])}</div>'''
        (OUT / f"overview-more-{mode}.html").write_text(doc("Flow more overview", body, mode,
            "body{background:var(--tint);padding:28px 36px}.hdr{display:flex;gap:16px;align-items:baseline;margin-bottom:18px}.g{display:grid;grid-template-columns:repeat(10,205px);gap:18px}.f{width:205px;height:442px;border-radius:26px;overflow:hidden;border:5px solid #1D1728;background:var(--bg)}.f iframe{border:0;transform:scale(.5);transform-origin:top right;display:block}.cap{text-align:center;margin-top:8px;font-size:13px;color:var(--text-secondary)}", w=2300), encoding="utf-8")
if __name__ == "__main__":
    build()
