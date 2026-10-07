# Flow design-system boards (pages 1–8, light + dark). Run: python3 ds.py && bash render-ds.sh
import pathlib
from tokens import COLOR, TYPE, SPACE, RADIUS, contrast
from flow import gbtn, appic, BASE, ic, num, n, tabbar, vars_css, EXTAG, STATUS, spin, sk
OUT = pathlib.Path(__file__).parent

def scope(mode):  # inline CSS variables so a block can show the other mode
    return ";".join(f"--{k}:{v}" for k, v in COLOR[mode].items())

CSS = '''
body{background:var(--bg);width:1440px}
.pg{padding:48px 64px 56px;direction:ltr}
.pg .rtl,.tyrow>div:last-child,.cmp .st>div,.phw iframe{direction:rtl}
.phd{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:24px;border-bottom:1px solid var(--line);direction:ltr}
.phd .l{display:flex;align-items:baseline;gap:14px} .phd .l .wm{font-size:28px;color:var(--logo)} .phd h1{font-size:30px;font-weight:600;font-family:Rubik}
.phd .r{text-align:right;font-size:13px;color:var(--text-muted);font-weight:400;line-height:1.6}
.intro{direction:ltr;text-align:left;font-size:16px;color:var(--text-secondary);max-width:900px;margin-top:20px;font-weight:400}
.grp2{margin-top:44px} .grp2>h2{direction:ltr;text-align:left;font-size:20px;font-weight:600} .grp2>p{direction:ltr;text-align:left;font-size:14px;color:var(--text-muted);font-weight:400;margin-top:2px}
.swrow{display:grid;grid-template-columns:repeat(6,1fr);gap:20px;margin-top:18px;direction:ltr}
.sw3 .blk{height:96px;border-radius:16px;border:1px solid var(--line);display:flex;align-items:flex-end;justify-content:flex-end;padding:10px 12px;direction:rtl;font-size:18px;font-weight:600}
.sw3 .nm{font-size:15px;font-weight:600;margin-top:10px;text-align:left} .sw3 .tk{font-size:12px;color:var(--text-muted);font-weight:400;text-align:left;font-family:"IBM Plex Mono",monospace}
.sw3 .hx{font-size:14px;text-align:left;font-family:"IBM Plex Mono",monospace;color:var(--text-secondary);font-weight:400} .sw3 .cr{font-size:12px;color:var(--text-muted);text-align:left;font-weight:400;margin-top:2px}
.tyrow{display:grid;grid-template-columns:260px 1fr;align-items:center;gap:32px;padding:18px 0;border-bottom:1px solid var(--line)}
.tyrow .meta{direction:ltr;text-align:left} .tyrow>div:last-child{text-align:right} .tyrow .meta b{display:block;font-size:16px;font-weight:600} .tyrow .meta span{font-size:13px;color:var(--text-muted);font-weight:400}
.wts{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:18px}
.wt{border:1px solid var(--line);border-radius:16px;padding:20px;direction:rtl} .wt .k{direction:ltr;text-align:left;font-size:13px;color:var(--text-muted);font-weight:400}
.cards{display:grid;gap:24px;margin-top:18px;direction:ltr}
.cmp{border:1px solid var(--line);border-radius:20px;padding:24px;background:var(--surface)}
.cmp>h3{font-size:17px;font-weight:600;text-align:left} .cmp>p{font-size:13px;color:var(--text-muted);font-weight:400;text-align:left;margin-top:2px}
.st{display:grid;gap:16px;margin-top:18px;align-items:start}
.st>div{direction:rtl} .st .cap{direction:ltr;text-align:left;font-size:12px;color:var(--text-muted);font-weight:500;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px}
.rowlbl{direction:ltr;text-align:left;font-size:13px;color:var(--text-secondary);font-weight:500;align-self:center}
.btn.pri.p{background:var(--accent-pressed)} .btn.sec.p{background:var(--tint-pressed)} .btn.gho.p,.btn.dng.p{background:var(--tint)}
.btn.pri.d,.btn.sec.d{background:var(--disabled-bg);color:var(--disabled-text)} .btn.gho.d,.btn.dng.d{color:var(--disabled-text)}
.fab.p{background:var(--accent-pressed)} .per.p{background:var(--tint-pressed)}
.chip.p{background:var(--tint)} .chip.sug.p{background:var(--tint-pressed)} .chip.d{color:var(--disabled-text);border-color:var(--line)} .chip.on.p{background:var(--accent-pressed)}
.sw.d{opacity:.45} .chk.d{opacity:.45}
.inp.err{border-color:var(--error)} .inp.d{background:var(--disabled-bg);border-color:transparent;color:var(--disabled-text)}
.msg{font-size:13px;color:var(--error);font-weight:400;margin-top:6px} .msg.h{color:var(--text-muted)}
.card.p{background:var(--tint-pressed)} .prp{background:var(--tint);border-radius:12px;padding-left:12px;padding-right:12px;margin:0 -12px}
.spr{display:grid;grid-template-columns:90px 1fr 1.4fr;align-items:center;gap:20px;padding:10px 0;border-bottom:1px solid var(--line);direction:ltr}
.spr i{display:block;height:20px;background:var(--accent);border-radius:4px} .spr b{font-weight:600;font-family:"IBM Plex Mono",monospace;font-size:14px} .spr span{font-size:14px;color:var(--text-secondary);font-weight:400}
.rds{display:grid;grid-template-columns:repeat(6,1fr);gap:20px;margin-top:18px;direction:ltr}
.rd .t{height:96px;background:var(--tint);border:2px solid var(--accent)} .rd b{display:block;margin-top:10px;font-size:15px;font-weight:600} .rd span{font-size:13px;color:var(--text-muted);font-weight:400}
.rules{direction:ltr;text-align:left;margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:10px 40px}
.rules div{font-size:15px;color:var(--text-secondary);font-weight:400;padding:10px 0;border-bottom:1px solid var(--line)} .rules b{color:var(--text);font-weight:600}
.phones{display:flex;gap:56px;justify-content:center;margin-top:24px;direction:ltr}
.phw{text-align:center} .phw .fr{width:402px;height:856px;border-radius:52px;border:6px solid #1D1728;overflow:hidden} .phw.dk .fr{border-color:#3A3350}
.phw iframe{border:0;display:block} .phw h3{font-size:18px;font-weight:600;margin-top:14px} .phw p{font-size:14px;color:var(--text-muted);font-weight:400}
.notes{direction:ltr;text-align:left;display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px}
.note{border:1px solid var(--line);border-radius:16px;padding:20px} .note h4{font-size:15px;font-weight:600} .note li{font-size:14px;color:var(--text-secondary);font-weight:400;margin:6px 18px 0 18px}
.mini{position:relative;height:100px;border:1px solid var(--line);border-radius:16px;overflow:hidden} .mini .tb{position:absolute}
.shbox{position:relative;height:300px;border-radius:16px;overflow:hidden;background:var(--bg);border:1px solid var(--line)}
'''
PAGES = ["Colours", "Type", "Spacing & corners", "Controls", "Content blocks", "Top band · light & dark", "Empty & loading states", "Pickers, sheets & errors"]
def page(no, mode, body, intro):
    return f'''<div class="pg"><div class="phd"><div class="l"><span class="wm">Flow</span><h1>{no}. {PAGES[no-1]}</h1></div>
<div class="r">Design system · {"Light" if mode=="light" else "Dark"} mode · page {no} of {len(PAGES)}<br>V1 Violet · Rubik · every text colour passes WCAG AA (4.5:1)</div></div>
<p class="intro">{intro}</p>{body}</div>'''
def cmp(title, desc, inner, cols):
    return f'<div class="cmp"><h3>{title}</h3><p>{desc}</p><div class="st" style="grid-template-columns:{cols}">{inner}</div></div>'
def cell(cap, html): return f'<div><div class="cap">{cap}</div>{html}</div>'

# ---------- 1 colours ----------
GROUPS = [
 ("Page and surfaces", "Quiet surfaces. The violet tint is the only fill colour.", [("bg","Page background"),("surface","Card / tab bar"),("tint","Violet tint fill"),("tint-pressed","Tint · pressed"),("line","Hairline"),("disabled-bg","Disabled fill")]),
 ("Text", "Figures always use the main text colour.", [("text","Main text"),("text-secondary","Secondary text"),("text-muted","Hints"),("disabled-text","Disabled text"),("on-accent","Text on violet")]),
 ("Violet accent", "Used sparingly: + button, primary button, links, active tab.", [("accent","Accent"),("accent-pressed","Accent · pressed"),("accent-text","Accent text & icons"),("logo","Logo (wordmark)")]),
 ("Top band", "The coloured area at the top of Home and Project.", [("band","Band"),("on-band","Band text"),("on-band-secondary","Band labels"),("band-chip","Chip on band")]),
 ("Meaning", "Always paired with an arrow or sign, never colour alone.", [("good","Good ▲"),("bad","Bad ▼"),("warning","Warning"),("error","Error")]),
 ("Controls", "Tracks, borders and focus rings. Non-text contrast: at least 3:1 against the page (WCAG 1.4.11).", [("control-off","Switch off · checkbox"),("control-border","Input border"),("knob","Switch knob"),("focus","Focus ring"),("focus-on-band","Focus on band"),("badge-bg","Tab badge"),("knob-on","Knob · switch on"),("bad-tint","Destructive button fill")]),
 ("Loading and feedback", "Skeleton placeholders are decorative and exempt from contrast rules.", [("skeleton","Skeleton"),("skeleton-shine","Skeleton shimmer"),("skeleton-band","Skeleton on band"),("skeleton-band-shine","Shimmer on band"),("toast-bad","Error icon in toast"),("badge-text","Badge number")]),
]
PAIR = {"logo":"bg","text":"bg","text-secondary":"bg","text-muted":"bg","on-accent":"accent","accent-text":"bg","on-band":"band","on-band-secondary":"band","good":"band-chip","bad":"band-chip","warning":"surface","error":"surface","accent":"surface","accent-pressed":"surface","control-off":"surface","control-border":"surface","knob":"control-off","knob-on":"accent","bad-tint":"bad","focus":"bg","focus-on-band":"band","badge-text":"badge-bg","toast-bad":"toast-bg"}
def p1(mode):
    C = COLOR[mode]; out = ""
    for g, d, items in GROUPS:
        sw = ""
        for k, nm in items:
            sample = ""
            if k in ("text","text-secondary","text-muted","accent-text","good","bad","warning","error","disabled-text"): blk = f'background:{C["bg"] if k not in ("good","bad") else C["band-chip"]};color:{C[k]}'; sample = "₪1,310 אבג"
            elif k == "logo": blk = f'background:{C["bg"]};color:{C[k]}'; sample = '<span style="font-weight:700;font-size:30px;letter-spacing:-.01em;direction:ltr">Flow</span>'
            elif k in ("on-accent",): blk = f'background:{C["accent"]};color:{C[k]}'; sample = "אישור"
            elif k in ("on-band","on-band-secondary"): blk = f'background:{C["band"]};color:{C[k]}'; sample = "₪200,000"
            elif k == "toast-bad": blk = f'background:{C["toast-bg"]};color:{C[k]}'; sample = "✕ הקובץ לא נקרא"
            elif k == "badge-text": blk = f'background:{C["badge-bg"]};color:{C[k]}'; sample = "7"
            elif k in ("focus", "focus-on-band"): blk = f'background:{C["bg"] if k=="focus" else C["band"]};box-shadow:inset 0 0 0 3px {C[k]}'
            elif k == "knob-on": blk = f'background:{C["accent"]};color:{C[k]}'; sample = '<span style="width:40px;height:40px;border-radius:9999px;background:currentColor;display:block"></span>'
            elif k == "bad-tint": blk = f'background:{C[k]};color:{C["bad"]}'; sample = "מחיקה"
            elif k == "knob": blk = f'background:{C["control-off"]};color:{C[k]}'; sample = '<span style="width:40px;height:40px;border-radius:9999px;background:currentColor;display:block"></span>'
            elif k in ("skeleton-band", "skeleton-band-shine"): blk = f'background:{C["band"]}'; sample = f'<span style="width:110px;height:16px;border-radius:8px;background:{C[k]};display:block"></span>'
            else: blk = f'background:{C[k]}'
            if k in ("text","text-secondary","text-muted","accent-text","good","bad","warning","error","disabled-text","on-accent","on-band","on-band-secondary"):
                chip = f'<span style="display:inline-block;width:18px;height:18px;border-radius:5px;background:{C[k]};border:1px solid var(--line);margin-right:8px;vertical-align:-3px"></span>'
            else: chip = ""
            cr = f'{contrast(C[k], C[PAIR[k]]):.1f}:1 on {PAIR[k]}' if k in PAIR else ("decorative / disabled — exempt" if k == "disabled-text" else ("decorative — exempt" if k.startswith("skeleton") else "&nbsp;"))
            sw += f'<div class="sw3"><div class="blk" style="{blk}">{sample}</div><div class="nm">{chip}{nm}</div><div class="hx">{C[k]}</div><div class="tk">{k}</div><div class="cr">{cr}</div></div>'
        out += f'<div class="grp2"><h2>{g}</h2><p>{d}</p><div class="swrow">{sw}</div></div>'
    lead = "White page" if mode == "light" else "Violet-tinted near-black page"
    return page(1, mode, out, f"Seven colour groups. {lead}, one violet accent, a coloured band only at the top of Home and Project. Numbers stay in the main text colour; red and green only carry meaning together with ▼ / ▲.")

# ---------- 2 type ----------
SAMPLES = {"hero": num(200000), "display": num(8500), "title-1": "פרויקטים", "title-2": "וילה רעננה", "heading": "ספטמבר", "title-3": "פרויקטים מובילים", "amount": num(1250), "body": f"{n(7)} פריטים ממתינים לאישור", "label": "רווח נקי בספטמבר", "meta": "חומרי בניין · וילה רעננה", "hint": f"רווחיות {n('27%')} · לפני {n(3)} ימים", "micro": "בית · פרויקטים · לאישור", "wordmark": '<span style="direction:ltr;display:inline-block">Flow</span>'}
USE = {"hero": "Main profit on Home", "display": "Amount on detail screens", "title-1": "Page titles", "title-2": "Sheet titles, project name", "heading": "Section and month heads", "title-3": "Compact titles, project row name", "amount": "Amounts in lists", "body": "Rows and main text", "label": "Labels, subtitles", "meta": "Row secondary lines", "hint": "Hints, dates, percentages", "micro": "Tab bar, badges", "wordmark": "Logo only"}
def p2(mode):
    rows = "".join(f'<div class="tyrow"><div class="meta"><b>{k}</b><span>{s}px · line {lh} · weight {w}<br>{USE[k]}</span></div><div style="font-size:{s}px;line-height:{lh};font-weight:{w};{"color:var(--text-muted);" if k=="hint" else ("color:var(--text-secondary);" if k in ("label","micro") else "")}{"color:var(--accent-text);" if k=="wordmark" else ""}">{SAMPLES[k]}</div></div>' for k, (s, lh, w) in TYPE.items())
    wts = "".join(f'<div class="wt"><div class="k">Rubik {w} · {nm}</div><div style="font-weight:{w};font-size:28px;margin-top:8px">רווח נקי</div><div style="font-weight:{w};font-size:28px">{num(1310000)}</div><div class="k" style="margin-top:6px">{use}</div></div>' for w, nm, use in [(400,"Regular","hints only"),(500,"Medium","body, labels"),(600,"Semibold","titles, amounts, hero"),(700,"Bold","wordmark only")])
    return page(2, mode, f'<div class="grp2"><h2>Scale</h2><p>Ten sizes. Hebrew and numbers in the same font; numbers use equal-width digits so columns line up.</p>{rows}</div><div class="grp2"><h2>Weights</h2><p>Heavier than usual on purpose: body text is 500, not 400.</p><div class="wts">{wts}</div></div>',
                "One free font, Rubik (Google Fonts, OFL), with its ₪ sign. Soft rounded shapes, solid weights. Right-to-left throughout; numbers are kept left-to-right inside Hebrew lines.")

# ---------- 3 spacing & corners ----------
def p3(mode):
    use = {"1":"icon to text","2":"between chips","3":"inside rows","4":"card padding, sheet gaps","5":"between hero lines","6":"page side margin","8":"between blocks","10":"between sections"}
    sp = "".join(f'<div class="spr"><b>{v}px</b><i style="width:{v*6}px"></i><span>{use[k]}</span></div>' for k, v in SPACE.items() if k.isdigit())
    rnames = {"chip":"Chips, pills, badges, switch","input":"Inputs, search, segmented","button":"Buttons","card":"Cards, tinted blocks","sheet":"Bottom sheet (top corners)","band":"Top band (bottom corners)"}
    rd = "".join(f'<div class="rd"><div class="t" style="border-radius:{min(v, 48) if k!="band" else "0 0 28px 28px"}{"px" if k!="band" else ""};{"border-radius:24px 24px 0 0;" if k=="sheet" else ""}"></div><b>{k} · {"full" if v > 100 else str(v)+"px"}</b><span>{rnames[k]}</span></div>' for k, v in RADIUS.items() if k != "fab")
    rules = "".join(f"<div><b>{a}</b> — {b}</div>" for a, b in [("24px","left and right page margin"),("36–40px","between sections"),("16px","inset of cards from the screen edge"),("44px","smallest touch target"),("52px","button and input height"),("86px","tab bar incl. home indicator"),("1 accent","per screen area, max ~2 filled violet shapes"),("No heavy shadows","depth comes from tint and hairlines; only the switch knob and selected tab get a faint one")])
    return page(3, mode, f'<div class="grp2"><h2>Spacing</h2><p>A 4-point scale. Generous on purpose — white space is part of the look. (Bars drawn 6× larger so they are visible.)</p>{sp}</div><div class="grp2"><h2>Corners</h2><p>Soft, consistent rounding.</p><div class="rds">{rd}</div></div><div class="grp2"><h2>Layout rules</h2><div class="rules">{rules}</div></div>',
                "How much room things get, and how round the corners are.")

# ---------- 4 controls ----------
def p4(mode):
    B = lambda cls, t: f'<div class="btn {cls}">{t}</div>'
    btn = ""
    for nm, c, t in [("Primary","pri","אישור"),("Secondary","sec","שינוי"),("Ghost / link","gho","דלג"),("Destructive","dng",f'{ic("trash",18,2)}מחיקה')]:
        btn += f'<div class="rowlbl">{nm}</div>' + "".join(f'<div>{B(c+" "+s, t)}</div>' for s in ("", "p", "d"))
    buttons = f'<div class="cmp"><h3>Buttons</h3><p>One primary per screen. 52px tall, 14px corners, Rubik 600.</p><div class="st" style="grid-template-columns:140px 1fr 1fr 1fr"><div></div><div class="cap">Default</div><div class="cap">Pressed</div><div class="cap">Disabled</div>{btn}</div></div>'
    fab = cmp("+ button (FAB)", "Opens “Add”. The only always-visible violet shape.", cell("Default", f'<span class="fab">{ic("plus",24,2.4)}</span>') + cell("Pressed", f'<span class="fab p">{ic("plus",24,2.4)}</span>'), "1fr 1fr")
    per = cmp("Period pill", "Choose the time range.", cell("Default", f'<span class="per">החודש {ic("down",16,2.25)}</span>') + cell("Pressed", f'<span class="per p">החודש {ic("down",16,2.25)}</span>') + cell("On band", f'<div style="background:var(--band);padding:10px;border-radius:12px"><span class="per" style="background:var(--band-pill)">החודש {ic("down",16,2.25)}</span></div>'), "1fr 1fr 1.2fr")
    chips = cmp("Chips", "Suggested (AI / recent) in tint; choices outlined in control-border (≥ 3:1); the chosen one filled.",
        cell("Suggested", f'<span class="chip sug">{ic("spark",15,2)}וילה רעננה</span>') + cell("Suggested · pressed", f'<span class="chip sug p">{ic("spark",15,2)}וילה רעננה</span>') + cell("Choice", '<span class="chip">הובלה</span>') + cell("Choice · pressed", '<span class="chip p">הובלה</span>') + cell("Selected", f'<span class="chip on">{ic("check",15,2.4)}חומרים</span>') + cell("Disabled", '<span class="chip d">ביטוח</span>') + cell("Status", f'<span class="stat">{ic("check",14,2.4)}שולם</span>'), "repeat(7,1fr)")
    seg = cmp("Segmented tabs", "Switch between 2–3 views. Selected = white (dark: raised violet).", cell("Two options", '<div class="seg"><span class="on">הוצאות</span><span>הכנסות</span></div>') + cell("Three options", '<div class="seg"><span>שווה בשווה</span><span class="on">לפי הכנסות</span><span>ידני</span></div>'), "1fr 1.4fr")
    sw = cmp("Switch and checkbox", f"Violet when on, knob-on knob ({contrast(COLOR[mode]['knob-on'], COLOR[mode]['accent']):.1f}:1). Off track and empty box use control-off ({contrast(COLOR[mode]['control-off'], COLOR[mode]['surface']):.1f}:1, ≥ 3:1). Overhead switch is off by default.",
        cell("On", '<span class="sw on"><i></i></span>') + cell("Off", '<span class="sw"><i></i></span>') + cell("Disabled", '<span class="sw on d"><i></i></span>') + cell("Checked", f'<span class="chk">{ic("check",16,2.6)}</span>') + cell("Unchecked", '<span class="chk off"></span>') + cell("Disabled", f'<span class="chk d">{ic("check",16,2.6)}</span>'), "repeat(6,1fr)")
    inp = cmp("Text input and search", f"Label above (hint size, secondary colour), 52px field with a 1px control-border ({contrast(COLOR[mode]['control-border'], COLOR[mode]['surface']):.1f}:1, ≥ 3:1), 2px violet when focused, red message on error.",
        cell("Default", '<div class="fld"><label>שם הפרויקט</label><div class="inp"><span class="ph">למשל: וילה רעננה</span></div></div>') +
        cell("Focused", '<div class="fld"><label>שם הפרויקט</label><div class="inp focus">גן יבנה</div></div>') +
        cell("Filled", '<div class="fld"><label>שם הפרויקט</label><div class="inp">גן יבנה – תוספת קומה</div></div>') +
        cell("Error", '<div class="fld"><label>ח.פ.</label><div class="inp err"><span class="n">51-2345</span></div><div class="msg">מספר קצר מדי – 9 ספרות</div></div>') +
        cell("Disabled", '<div class="fld"><label>טלפון</label><div class="inp d"><span class="n">050-123-4567</span></div></div>'), "repeat(5,1fr)")
    srch = cmp("Search", f"Surface field with a 1px control-border ({contrast(COLOR[mode]['control-border'], COLOR[mode]['surface']):.1f}:1), violet ring while typing.", cell("Empty", f'<div class="inp search">{ic("search",20,2)}<span class="ph">חיפוש פרויקט או קוד</span></div>') + cell("Typing", f'<div class="inp search" style="box-shadow:inset 0 0 0 1.5px var(--accent)">{ic("search",20,2)}<span>וילה</span></div>'), "1fr 1fr")
    body = f'''<div class="cards" style="grid-template-columns:1.6fr 1fr">{buttons}<div style="display:grid;gap:24px">{fab}{per}</div></div>
<div class="cards" style="grid-template-columns:1fr">{chips}</div>
<div class="cards" style="grid-template-columns:1fr 1.3fr">{seg}{sw}</div>
<div class="cards" style="grid-template-columns:1fr">{inp}</div><div class="cards" style="grid-template-columns:1fr 1fr">{srch}<div></div></div>'''
    return page(4, mode, body, "Everything you tap, with its states: default, pressed (while the finger is down), selected, and disabled (can’t be used yet).")

# ---------- 5 content blocks ----------
def p5(mode):
    pend = lambda cls: f'<div class="card {cls}" style="margin:0">{ic("inbox",22,1.9)}<div class="tx"><div style="font-size:17px">{n(7)} פריטים ממתינים לאישור</div><div class="hint">{n(3)} חשבוניות לא שולמו · {num(23400)}</div></div><span class="cv">{ic("chev",20,2)}</span></div>'
    pending = cmp("Pending card", "The one tinted block on Home. Taps through to review.", cell("Default", pend("")) + cell("Pressed", pend("p")), "minmax(0,420px) minmax(0,420px)")
    prow = lambda nm, m, v, cls="": f'<div class="pr {cls}"><div><div class="nm">{nm}</div><div class="hint">רווחיות {n(m)}</div></div><div class="amt{" bad" if v < 0 else ""}">{num(v)}</div></div>'
    rows = cmp("Project row", "Name and margin on the right, profit on the left. A loss is red with a minus sign.", cell("Profit", prow("וילה רעננה","28%",50000)) + cell("Loss", prow('שיפוץ דירה ת"א',"−17%",-10000)) + cell("Pressed", prow("וילה רעננה","28%",50000,"prp")), "1fr 1fr 1fr")
    trow = lambda icn, nm, sub, v: f'<div class="rowi">{ic(icn,22,1.9)}<div class="tx"><div>{nm}</div><div class="hint">{sub}</div></div><span class="n" style="font-weight:600">{num(v, sign=True)}</span></div>'
    tx = cmp("Transaction row", "Grey icon shows the source; amount in main text colour with its sign.", cell("Expense · invoice", trow("doc",'טמבור בע"מ',f"חומרים · {n('22/09')}",-12000)) + cell("Income · bank", trow("bank","העברה מהלקוח – משפ׳ כהן",f"הכנסה · {n('20/09')}",150000)), "1fr 1fr")
    delta = cmp("Change pill", "Month-over-month change. On the band it sits in a solid pill so the red/green stays readable.",
        cell("On band · down", f'<div style="background:var(--band);padding:12px;border-radius:12px"><span class="delta dn">▼ {n("10%")}</span></div>') + cell("On band · up", f'<div style="background:var(--band);padding:12px;border-radius:12px"><span class="delta up">▲ {n("8%")}</span></div>') +
        cell("On page · down", f'<div style="padding:12px 0"><span class="delta dn flat">▼ {n("10%")}</span></div>') + cell("On page · up", f'<div style="padding:12px 0"><span class="delta up flat">▲ {n("8%")}</span></div>'), "repeat(4,1fr)")
    tabs = cmp("Tab bar", "Four places plus the + button. Active = violet icon and label. Badge = items waiting.", f'<div style="grid-column:1/-1"><div class="mini">{tabbar("home")}</div></div>', "1fr")
    sheet = cmp("Bottom sheet", "Slides up over a dimmed screen for short tasks. Close with ✕ or by tapping outside.",
        f'''<div style="grid-column:1/-1"><div class="shbox"><div class="scrim"></div><div class="sheet" style="padding-bottom:20px"><div class="grab"></div><div class="shd"><div><div class="t2">סימון כשולם</div><div class="lbl">חומרי בניין השרון · {num(9400)}</div></div><span class="iconbtn" style="margin:-6px -12px 0 0">{ic("x",22,2)}</span></div>
<div class="pad" style="margin-top:14px"><div class="seg"><span class="on">מזומן</span><span>צ׳ק</span><span>אחר</span></div></div><div class="acts" style="margin-top:14px"><div class="btn pri">שמירה</div></div></div></div></div>''', "1fr")
    empty = cmp("Empty state", "When there is nothing to show: calm icon, one line, one way forward.", f'<div style="grid-column:1/-1" class="empty">{ic("checkc",44,1.6)}<div class="t3">הכל מאושר</div><div class="hint">אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש.</div><span class="btn sm sec" style="margin-top:8px">לדף הבית</span></div>', "1fr")
    toast = cmp("Toast", "Short confirmation above the tab bar for 4 seconds, with undo.", cell("Confirmation", f'<div class="toast">{ic("check",18,2.4)}<span>אושר · וילה רעננה</span><span class="u">ביטול</span></div>') + cell("Error", f'<div class="toast"><span style="color:var(--toast-bad)">{ic("info",18,2.2)}</span><span>הקובץ לא נקרא</span><span class="u">שוב</span></div>'), "1fr 1fr")
    body = f'''<div class="cards" style="grid-template-columns:1fr">{pending}</div><div class="cards" style="grid-template-columns:1fr">{rows}</div>
<div class="cards" style="grid-template-columns:1fr">{tx}</div><div class="cards" style="grid-template-columns:1fr">{delta}</div>
<div class="cards" style="grid-template-columns:1fr 1fr">{tabs}{toast}</div>
<div class="cards" style="grid-template-columns:1.3fr 1fr">{sheet}{empty}</div>'''
    return page(5, mode, body, "The building blocks screens are made of.")

# ---------- 6 band ----------
def p6(mode):
    L, D = COLOR["light"], COLOR["dark"]
    body = f'''<div class="phones"><div class="phw"><div class="fr"><iframe src="01-home-light.html" width="390" height="844" scrolling="no"></iframe></div><h3>Light</h3><p>band {L["band"]} · text {L["on-band"]} ({contrast(L["on-band"], L["band"]):.1f}:1) · labels {L["on-band-secondary"]} ({contrast(L["on-band-secondary"], L["band"]):.1f}:1)</p></div>
<div class="phw dk"><div class="fr"><iframe src="01-home-dark.html" width="390" height="844" scrolling="no"></iframe></div><h3>Dark</h3><p>band {D["band"]} · text {D["on-band"]} ({contrast(D["on-band"], D["band"]):.1f}:1) · labels {D["on-band-secondary"]} ({contrast(D["on-band-secondary"], D["band"]):.1f}:1)</p></div></div>
<div class="notes"><div class="note"><h4>How the band works</h4><ul><li>Solid violet, no gradient, rounded bottom corners (28px).</li><li>Holds only the summary: logo, period, greeting, profit, change, income and expenses.</li><li>Used on Home and the Project header. All other screens are white with violet accents.</li><li>The change sits in a solid pill so red ▼ / green ▲ stay readable on violet.</li></ul></div>
<div class="note"><h4>In dark mode</h4><ul><li>The page becomes a violet-tinted near-black ({D["bg"]}), never pure black.</li><li>The band keeps the same violet as light mode ({D["band"]}) with white text, so Flow looks the same in both modes.</li><li>Accent brightens to {D["accent"]} with dark text on it; the period pill and change pill become dark surfaces ({D["band-chip"]}).</li><li>Good and bad lighten to {D["good"]} / {D["bad"]} so they pass 4.5:1.</li></ul></div></div>'''
    return page(6, mode, body, "The signature of Flow: one confident violet area at the top of Home, white below. Same screen, light and dark.")


# ---------- 7 empty & loading ----------
def p7(mode):
    C = COLOR[mode]
    skrow = f'<div class="pr" style="padding:14px 0"><div style="display:flex;flex-direction:column;gap:8px">{sk(150,14)}{sk(72,10)}</div>{sk(78,14)}</div>'
    skel = cmp("Skeleton", "Violet-grey bars in the shape of the real content. Chrome that is always known (logo, headings, tab bar, search) stays real. Shimmer sweeps every 1.4 s; still when reduced motion is on.",
        cell("Text lines", f'<div style="display:flex;flex-direction:column;gap:10px">{sk(180,14)}{sk(130,10)}{sk(150,10)}</div>') +
        cell("Row", f'<div class="rows">{skrow}{skrow}</div>') +
        cell("Card", f'<div class="card" style="margin:0">{sk(22,22,11)}<div class="tx" style="display:flex;flex-direction:column;gap:8px">{sk(170,14)}{sk(120,10)}</div></div>') +
        cell("On the band", f'<div class="band" style="border-radius:16px;padding:16px">{sk(110,14)}{sk(190,36,10,"margin-top:12px")}<div style="display:flex;gap:8px;margin-top:12px">{sk(60,22,11)}{sk(90,14)}</div></div>'), "1fr 1.2fr 1.2fr 1.2fr")
    btns = cmp("Busy button and spinner", "The pressed button keeps its size, shows a spinner and a verb in progress (\u201c<bdi>מאשר…</bdi>\u201d). Other actions on the screen are disabled until it finishes.",
        cell("Primary · default", f'<div class="btn pri">{ic("check",20,2.4)}אישור</div>') + cell("Primary · busy", f'<div class="btn pri load">{spin(20,2.6)}מאשר…</div>') +
        cell("Secondary · busy", f'<div class="btn sec">{spin(20,2.6)}שומר…</div>') + cell("Spinner 18 · 20 · 24", f'<div class="acc" style="display:flex;gap:18px;align-items:center;height:52px">{spin(18,2.6)}{spin(20,2.6)}{spin(24,2.4)}</div>') +
        cell("Pull to refresh", f'<div class="band" style="border-radius:16px"><div class="ptr"><span>{spin(20,2.6)}</span></div></div>'), "repeat(5,1fr)")
    steps = "".join(f'<div class="rowi{" wait" if s=="wait" else ""}"><span class="dot">{d}</span><div class="tx" style="{"color:var(--text-muted)" if s=="wait" else ""}">{t}</div></div>' for s, d, t in [("done", ic("check",18,2.6), f"{n(42)} שורות נקלטו"), ("now", spin(18,2.6), "מתאימים לחשבוניות ולפרויקטים"), ("wait", '<i class="o"></i>', "מזהים העברות בין החשבונות")])
    prog = cmp("Processing a file", "Bank report or invoice photo. A real progress bar, the step being done now, and a calm line on how long it takes. It can continue in the background.",
        cell("Progress + steps", f'<div style="display:flex;justify-content:space-between"><span class="lbl">שלב {n(2)} מתוך {n(3)}</span><span class="hint">{n("60%")}</span></div><div class="prog" style="margin-top:8px"><i style="width:60%"></i></div><div class="list steps" style="margin-top:6px">{steps}</div>') +
        cell("Fields filling in", f'<div class="rows"><div class="pr" style="padding:12px 0"><span class="lbl">ספק</span><span>חומרי בניין השרון</span></div><div class="pr" style="padding:12px 0"><span class="lbl">סכום</span>{sk(84,14)}</div><div class="pr" style="padding:12px 0"><span class="lbl">תאריך</span>{sk(70,14)}</div></div>') +
        cell("Reassurance", f'<div class="card" style="margin:0;padding:12px 14px">{ic("clock",20,1.9)}<div class="tx" style="font-size:15px">זה לוקח בערך חצי דקה. אפשר לצאת – נודיע כשזה מוכן.</div></div>'), "1.2fr 1fr 1fr")
    emp = cmp("Empty state", "A calm line icon in a tint circle, a short title, one line and at most one button. No emoji, no illustrations. Positive when the list is empty because the work is done.",
        cell("Full screen", f'<div class="empty lg" style="padding:8px 0"><span class="eic">{ic("folder",36,1.6)}</span><div class="t2">עוד אין פרויקטים</div><div class="ln">פרויקטים נפתחים מעצמם כשמזהים לקוח חוזר בדוח הבנק.</div><div class="btn pri">{ic("plus",20,2.4)}פרויקט חדש</div></div>') +
        cell("Positive · done", f'<div class="empty lg" style="padding:8px 0"><span class="eic">{ic("checkc",36,1.6)}</span><div class="t2">הכל מאושר</div><div class="ln">אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש.</div><div class="btn sec">לדף הבית</div></div>') +
        cell("No results", f'<div class="empty lg" style="padding:8px 0"><span class="eic">{ic("search",36,1.6)}</span><div class="t2">לא מצאנו ״גבעתיים״</div><div class="ln">אפשר לחפש לפי שם פרויקט, לקוח או קוד.</div><div class="btn gho" style="width:auto;padding:0 20px">ניקוי החיפוש</div></div>') +
        cell("Inline (inside a section)", f'<div class="empty">{ic("doc",32,1.6)}<div class="t3">אין תנועות החודש</div><div class="hint">תנועות חדשות יופיעו כאן.</div></div>'), "repeat(4,1fr)")
    err = cmp("Error and offline", "Say what happened and that nothing was lost, then offer one way forward. With cached data, keep the screen and add a notice line.",
        cell("Nothing cached", f'<div class="empty lg" style="padding:8px 0"><span class="eic">{ic("wifioff",36,1.6)}</span><div class="t2">אין חיבור לאינטרנט</div><div class="ln">בדקו את החיבור ונסו שוב. שום דבר לא נמחק.</div><div class="btn pri">{ic("refresh",20,2)}ניסיון חוזר</div></div>') +
        cell("Cached data · notice line", f'<div class="banner" style="margin:0">{ic("wifioff",18,2)}<span>אין חיבור · נתונים מ-{n("09:12")}</span><span class="u">ניסיון חוזר</span></div>') +
        cell("Failed action · toast", f'<div class="toast"><span style="color:var(--toast-bad)">{ic("info",18,2.2)}</span><span>הקובץ לא נקרא</span><span class="u">שוב</span></div>'), "1fr 1.2fr 1fr")
    tk = "".join(f'<div class="sw3"><div class="blk" style="background:{C["band"] if "band" in k else C["bg"]}"><span style="width:100%;height:18px;border-radius:9px;background:{C[k]};display:block"></span></div><div class="nm">{k}</div><div class="hx">{C[k]}</div><div class="cr">decorative — exempt</div></div>' for k in ("skeleton","skeleton-shine","skeleton-band","skeleton-band-shine"))
    phones = "".join(f'<div class="phw{" dk" if mode=="dark" else ""}"><div class="fr"><iframe src="{f}-{mode}.html" width="390" height="844" scrolling="no"></iframe></div><h3>{t}</h3><p>{d}</p></div>' for f, t, d in [("es-01-home-first-run","Home · first run","One action: import the bank report"),("ld-01-home-skeleton","Home · loading","Band chrome real, figures as bars"),("ld-05-upload-processing","Reading a bank report","Progress, current step, calm message")])
    notes = ('<div class="notes"><div class="note"><h4>When to use which</h4><ul><li>Under 300 ms: show nothing. Longer: a skeleton for screens and lists, a spinner in the button for an action.</li>'
             '<li>Files (bank report, invoice photo): a progress screen with steps; it can keep running in the background.</li><li>Pull to refresh: a spinner in a pill on the band; content stays visible.</li>'
             '<li>Offline with data: keep the screen and add the notice line. Offline without data: full error with \u201c<bdi>ניסיון חוזר</bdi>\u201d.</li></ul></div>'
             '<div class="note"><h4>Copy rules for empty and error states</h4><ul><li>A title of 2–4 words, one line of explanation, at most one button.</li><li>Gender-neutral Hebrew (plural or impersonal: \u201c<bdi>בדקו</bdi>\u201d, \u201c<bdi>מעלים</bdi>\u201d).</li>'
             '<li>Line icons from the Flow set in text-muted on a tint circle. No emoji, no illustrations.</li><li>Files: es-NN / ld-NN, light and dark, in this folder; all in one grid in overview-states.</li></ul></div></div>')
    body = (f'<div class="grp2"><h2>Skeleton tokens</h2><p>Two for the page, two for the violet band (white 20% / 32% over the band, the same in both modes).</p><div class="swrow" style="grid-template-columns:repeat(4,1fr)">{tk}</div></div>'
            f'<div class="cards" style="grid-template-columns:1fr">{skel}</div><div class="cards" style="grid-template-columns:1fr">{btns}</div>'
            f'<div class="cards" style="grid-template-columns:1fr">{prog}</div><div class="cards" style="grid-template-columns:1fr">{emp}</div><div class="cards" style="grid-template-columns:1fr">{err}</div>'
            f'<div class="phones" style="gap:36px">{phones}</div>{notes}')
    return page(7, mode, body, "What a screen shows before it has data, while it is loading, when there is nothing to show, and when something fails.")

# ---------- 8 pickers, sheets & errors ----------
def p8(mode):
    from more import calendar_html
    C = COLOR[mode]
    dstate = lambda cls, d: f'<div class="days" style="padding:0;grid-template-columns:repeat(1,52px)"><span class="d {cls}"><b>{d}</b></span></div>'
    days = cmp("Calendar day", "44px cells, 40px circles. Week starts on Sunday (right). Future dates are disabled for transactions and reports.",
        cell("Default", dstate("", 14)) + cell("Today", dstate("today", 26)) + cell("Selected", dstate("sel", 21)) +
        cell("Range", '<div class="days" style="padding:0;grid-template-columns:repeat(3,52px)"><span class="d sel rs"><b>7</b></span><span class="d mid"><b>8</b></span><span class="d sel re"><b>9</b></span></div>') +
        cell("Disabled (future)", dstate("off", 29)), "repeat(4,1fr) 1.2fr")
    cal = cmp("Date picker · single", "Bottom sheet: title, quick chips (היום / אתמול), month with ‹ › (next is disabled in the current month), Sunday-first grid, the chosen date in words, one confirm button.",
        f'<div style="grid-column:1/-1;display:grid;grid-template-columns:390px 1fr;gap:40px;align-items:start"><div style="border:1px solid var(--line);border-radius:20px;padding:12px 0 16px"><div class="pad chips"><span class="chip">היום</span><span class="chip">אתמול</span></div><div style="margin-top:10px">{calendar_html(2026,9,sel=21)}</div></div>'
        f'<div style="display:flex;flex-direction:column;gap:20px"><div class="cap" style="direction:ltr;text-align:left">The field that opens it</div><div class="fld"><label>תאריך</label><div class="inp"><span class="n">21/09/2026</span><span style="margin-inline-start:auto;color:var(--text-muted);display:grid">{ic("cal",20,2)}</span></div></div>'
        f'<div class="cap" style="direction:ltr;text-align:left">Range: two fields above the grid, the active one focused</div><div style="display:flex;gap:12px"><div class="fld" style="flex:1"><label>מתאריך</label><div class="inp"><span class="n">07/09/2026</span></div></div><div class="fld" style="flex:1"><label>עד תאריך</label><div class="inp focus"><span class="n">18/09/2026</span></div></div></div>'
        f'<div class="cap" style="direction:ltr;text-align:left">Range quick chips</div><div class="chips"><span class="chip">החודש</span><span class="chip">חודש קודם</span><span class="chip">מתחילת השנה</span></div></div></div>', "1fr")
    def o(t, h, on=False):
        return f'<div class="opt"><div class="tx"><div>{t}</div><div class="hint">{h}</div></div><span class="rd{" on" if on else ""}">{ic("check",14,2.8) if on else ""}</span></div>'
    per = cmp("Period sheet", "Opened from the band pill. Tapping an option applies it and closes the sheet; ‘טווח מותאם’ opens the range picker instead.",
        f'<div style="grid-column:1/-1" class="list">{o("החודש", f"ספטמבר {n(2026)}", True)}{o("חודש קודם", f"אוגוסט {n(2026)}")}<div class="opt"><span class="acc" style="display:grid">{ic("cal",22,1.9)}</span><div class="tx"><div>טווח מותאם</div><div class="hint">בחירת תאריכים בלוח</div></div><span style="color:var(--text-muted);display:grid">{ic("chev",20,2)}</span></div></div>', "1fr")
    conf = cmp("Confirmation sheet", "Question as the title, the item as the subtitle, one line on the consequence. Destructive: bad-tint fill with red text, never a solid red block. Always a quiet ‘ביטול’.",
        cell("Neutral (archive, hide, merge)", '<div class="acts" style="padding:0"><div class="btn pri">העברה לארכיון</div><div class="btn gho" style="height:44px;color:var(--text-secondary)">ביטול</div></div>') +
        cell(f"Destructive · bad on bad-tint {contrast(C['bad'], C['bad-tint']):.1f}:1", f'<div class="acts" style="padding:0"><div class="btn dngs">{ic("trash",20,2)}מחיקה</div><div class="btn gho" style="height:44px;color:var(--text-secondary)">ביטול</div></div>'), "1fr 1fr")
    errs = cmp("Error pattern", "Say what happened, that nothing was lost, and give one action. No red blocks: red only for a field border, its message, or the icon of a note.",
        cell("Sign-in note · cancelled (neutral)", f'<div class="note"><span class="ni">{ic("info",20,2)}</span><div><div class="nt">הכניסה לא הושלמה</div><div class="nl">החלון של Google נסגר. אפשר לנסות שוב.</div></div></div>') +
        cell("Sign-in note · failed", f'<div class="note bad"><span class="ni">{ic("info",20,2)}</span><div><div class="nt">לא הצלחנו להתחבר</div><div class="nl">כדאי לבדוק את החיבור ולנסות שוב.</div></div></div>') +
        cell("Wrong file", f'<span class="filechip">{ic("doc",18,1.9)}<bdi>קבלות_ספטמבר.pdf</bdi></span>') +
        cell("Save failed · toast", f'<div class="toast"><span style="color:var(--toast-bad);display:grid">{ic("info",18,2.2)}</span><span>לא נשמר – אין חיבור</span><span class="u">ניסיון חוזר</span></div>'), "1.3fr 1.3fr 1fr 1.2fr")
    gs = cmp("Sign in with Google", f"Google branding, light theme in both modes: white fill, 1px #747775 stroke ({contrast(C['gsi-border'], C['bg']):.1f}:1 on the page), #1F1F1F text ({contrast(C['gsi-text'], C['gsi-bg']):.1f}:1), the standard four-colour G at 20px on the start side, pill, 52px high. Text <bdi dir=rtl>המשך עם Google</bdi> (Roboto Medium; Hebrew falls back to Rubik). Only sign-in method in the POC.",
        cell("Default", gbtn()) + cell("Pressed · 12% overlay", gbtn("press")) + cell("Focus · app focus ring", gbtn("foc")) + cell("Loading · Google window open", gbtn("load")) + cell("Disabled", gbtn("dis")), "repeat(5,1fr)")
    inst = cmp("Install prompt", "Android: one ‘התקנה’ button (the browser’s install event). iPhone: three numbered steps with the Safari icons in tint tiles.",
        cell("App icon", appic()) + cell("Step", f'<div style="display:flex;gap:14px;align-items:center"><span class="stepn n">1</span><span style="line-height:2">מקישים על <span class="tile">{ic("share",18,2)}</span> ״שיתוף״</span></div>') +
        cell("Android action", f'<div class="btn pri">{ic("download",20,2)}התקנה</div>'), "0.6fr 1.4fr 1fr")
    bk = cmp("Overhead breakdown (switch on)", "Before, the share (by income share) and after. Three rows, the total in semibold. The band shows only the ‘after’ figure.",
        f'<div style="grid-column:1/-1" class="bk"><div class="pr"><div class="nm">רווח לפני כלליות</div><div class="amt">{num(180000)}</div></div><div class="pr" style="border-top:1px solid var(--line)"><div><div class="nm">חלק בהוצאות הכלליות</div><div class="hint">{n("21%")} מההכנסות של כל הפרויקטים</div></div><div class="amt">{num(-37800)}</div></div><div class="pr tot"><div class="nm">רווח אחרי כלליות</div><div class="amt">{num(142200)}</div></div></div>', "1fr")
    sw = cmp("Switch · fixed", f"On: knob-on on accent ({contrast(C['knob-on'], C['accent']):.1f}:1). Off: knob on control-off ({contrast(C['knob'], C['control-off']):.1f}:1). Both ≥ 3:1.",
        cell("On", '<span class="sw on"><i></i></span>') + cell("Off", '<span class="sw"><i></i></span>'), "1fr 1fr")
    phones = "".join(f'<div class="phw{" dk" if mode=="dark" else ""}"><div class="fr"><iframe src="{f}-{mode}.html" width="390" height="844" scrolling="no"></iframe></div><h3>{t}</h3><p>{d}</p></div>' for f, t, d in [("15b-date-single","Date picker","Single date for a transaction"),("16-period-sheet","Period sheet","From the band pill"),("20-confirm-delete","Confirm delete","Soft destructive button")])
    body = (f'<div class="cards" style="grid-template-columns:1fr">{days}</div><div class="cards" style="grid-template-columns:1fr">{cal}</div>'
            f'<div class="cards" style="grid-template-columns:1fr 1fr">{per}{conf}</div><div class="cards" style="grid-template-columns:1fr">{gs}</div><div class="cards" style="grid-template-columns:1fr">{errs}</div>'
            f'<div class="cards" style="grid-template-columns:1.4fr 1fr">{inst}{sw}</div><div class="cards" style="grid-template-columns:1fr">{bk}</div>'
            f'<div class="phones" style="gap:36px">{phones}</div>')
    return page(8, mode, body, "Pickers, confirmations, Google sign-in, errors and the install prompt. Israeli conventions: Sunday first, dd/mm/yyyy, Hebrew month names, fully right-to-left.")

FNS = [p1, p2, p3, p4, p5, p6, p7, p8]
SLUG = ["ds-1-colours", "ds-2-type", "ds-3-spacing", "ds-4-controls", "ds-5-content", "ds-6-band", "ds-7-empty-loading", "ds-8-pickers-sheets"]
def build():
    for mode in ("light", "dark"):
        for i, (fn, sl) in enumerate(zip(FNS, SLUG)):
            html = f'''<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Flow DS {sl} {mode}</title><style>{vars_css(mode)}{BASE}{CSS}</style></head><body class="still">{fn(mode)}</body></html>'''
            (OUT / f"{sl}-{mode}.html").write_text(html, encoding="utf-8")
if __name__ == "__main__":
    build()
