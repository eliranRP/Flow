# Hi-fi Home style directions. Example data. The owner's choice is not made.
# Writes style-a-calm.html, style-b-dark.html, style-c-warm.html, style-overview.html
# next to this file. render.sh screenshots them into ../../design/.
import base64
import pathlib
import re
import urllib.request

OUT = pathlib.Path(__file__).parent
FONT_DIR = pathlib.Path("/tmp/fonts")

FAMILIES = {
    "IBM Plex Sans Hebrew": "ibm-plex-sans-hebrew",
    "Heebo": "heebo",
    "Rubik": "rubik",
}

THEMES = [
    {
        "id": "style-a-calm",
        "key": "A",
        "name": "Calm fintech",
        "font": "IBM Plex Sans Hebrew",
        "bg": "#F5F7F9",
        "card": "#FFFFFF",
        "accent": "#0F4C5C",
        "good": "#12875A",
        "bad": "#D14343",
        "text": "#163038",
        "muted": "#5C6E76",
        "line": "#E3E8EC",
        "soft": "#E7F2EF",
        "banner": "#E6EEF1",
        "shadow": "0 10px 28px rgba(15,76,92,.08)",
    },
    {
        "id": "style-b-dark",
        "key": "B",
        "name": "Bold dark",
        "font": "Heebo",
        "bg": "#07090C",
        "card": "#12171E",
        "accent": "#22E4F0",
        "good": "#35E07D",
        "bad": "#FF5D5D",
        "text": "#F2F6F8",
        "muted": "#93A0AE",
        "line": "#243040",
        "soft": "#10241C",
        "banner": "#102228",
        "shadow": "0 12px 32px rgba(0,0,0,.45)",
    },
    {
        "id": "style-c-warm",
        "key": "C",
        "name": "Warm practical",
        "font": "Rubik",
        "bg": "#F3ECE1",
        "card": "#FFFBF4",
        "accent": "#F2A516",
        "good": "#2E8A4E",
        "bad": "#C73B2C",
        "text": "#2A2019",
        "muted": "#7A6A58",
        "line": "#E6D9C6",
        "soft": "#E7F3EA",
        "banner": "#F8E7C4",
        "shadow": "0 10px 28px rgba(42,32,25,.08)",
    },
]


def ensure_fonts():
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    css_path = FONT_DIR / "faces.css"
    if not css_path.exists() or not list(FONT_DIR.glob("*.ttf")):
        url = (
            "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800"
            "&family=Rubik:wght@400;500;600;700;800"
            "&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&display=swap"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        css = urllib.request.urlopen(req, timeout=30).read().decode()
        css_path.write_text(css)
    css = css_path.read_text()
    found = re.findall(
        r"font-family: '([^']+)';\s*font-style: normal;\s*font-weight: (\d+);"
        r"\s*font-display: swap;\s*src: url\(([^)]+)\)",
        css,
    )
    for fam, weight, src in found:
        slug = FAMILIES[fam]
        dest = FONT_DIR / f"{slug}-{weight}.ttf"
        if not dest.exists():
            urllib.request.urlretrieve(src, dest)


def font_css():
    ensure_fonts()
    chunks = []
    for fam, slug in FAMILIES.items():
        for path in sorted(FONT_DIR.glob(f"{slug}-*.ttf")):
            weight = path.stem.rsplit("-", 1)[1]
            data = base64.b64encode(path.read_bytes()).decode()
            chunks.append(
                "@font-face{"
                f"font-family:'{fam}';font-weight:{weight};font-style:normal;"
                f"src:url(data:font/ttf;base64,{data}) format('truetype');"
                "}"
            )
    return "\n".join(chunks)


def money(n, kind="neutral"):
    sign = "−" if n < 0 else ""
    cls = "bad" if n < 0 else ("good" if kind == "profit" else "")
    return f'<span class="num {cls}">{sign}₪{abs(n):,}</span>'


ROWS = [
    ("בניין מגורים חולון", 80000, 220000, 300000),
    ("וילה רעננה", 50000, 130000, 180000),
    ('מגדל משרדים פ"ת', 40000, 210000, 250000),
    ("בית פרטי כפר סבא", 30000, 90000, 120000),
    ('שיפוץ דירה ת"א', -10000, 70000, 60000),
]


def bars(profit, expenses, income):
    scale = 520000
    if profit >= 0:
        return (
            f'<i class="exp" style="width:{expenses / scale * 100:.1f}%"></i>'
            f'<i class="pro" style="width:{profit / scale * 100:.1f}%"></i>'
        )
    return (
        f'<i class="exp" style="width:{income / scale * 100:.1f}%"></i>'
        f'<i class="loss" style="width:{-profit / scale * 100:.1f}%"></i>'
    )


def phone(theme):
    rows = ""
    for name, profit, expenses, income in ROWS:
        rows += f'''<div class="row"><div class="top"><span class="name">{name}</span>{money(profit, "profit")}</div>
<div class="bar">{bars(profit, expenses, income)}</div></div>'''
    return f'''<div class="phone" style="--bg:{theme["bg"]};--card:{theme["card"]};--accent:{theme["accent"]};--good:{theme["good"]};--bad:{theme["bad"]};--text:{theme["text"]};--muted:{theme["muted"]};--line:{theme["line"]};--soft:{theme["soft"]};--banner:{theme["banner"]};--shadow:{theme["shadow"]};--font:'{theme["font"]}',sans-serif">
<div class="status"><span>9:41</span><span class="sig">▮▮▮</span></div>
<div class="body">
<div class="hello"><div><div class="h1">שלום, יוסי</div><div class="sub">סיכום החברה · 17 פרויקטים פעילים · ספטמבר 2026</div></div><div class="menu">☰</div></div>
<div class="seg"><div class="on">החודש</div><div>חודש קודם</div><div>מתחילת השנה</div></div>
<div class="kpis">
<div class="kpi"><div class="l">הכנסות</div><div class="v">{money(1310000)}</div><div class="d good">▲ 8%</div></div>
<div class="kpi"><div class="l">הוצאות</div><div class="v">{money(1110000)}</div><div class="d bad">▲ 12%</div></div>
<div class="kpi profit"><div class="l">רווח/הפסד</div><div class="v good">{money(200000, "profit")}</div><div class="d bad">▼ 10%</div></div>
</div>
<div class="banner"><span class="dot">7</span><span>7 פריטים ממתינים לאישור</span><span class="go">‹</span></div>
<div class="unpaid">3 חשבוניות לא שולמו · {money(23400)}</div>
<div class="sect"><span>פרויקטים · 5 המובילים</span><span class="pill">לפי פעילות</span></div>
{rows}
<div class="row more"><div class="top"><span class="name">עוד 12 פרויקטים</span>{money(70000, "profit")}</div><div class="sub">רווח</div></div>
<div class="row oh"><div class="top"><span class="name">הוצאות כלליות</span>{money(-60000)}</div><div class="sub">תקורה</div></div>
</div>
<div class="nav"><div>בית</div><div>פרויקטים</div><div class="plus">+</div><div class="rev">לאישור<span>7</span></div><div>הגדרות</div></div>
</div>'''


CSS = r"""
*{box-sizing:border-box;margin:0;padding:0}
body{margin:0;background:#d9dde2}
.page{width:460px;height:980px;padding:28px 28px 0}
.cap{font-family:Inter,sans-serif;font-size:14px;font-weight:650;letter-spacing:.01em;margin-bottom:12px;color:#243038}
.cap small{font-weight:500;color:#667}
.phone{width:390px;height:844px;border-radius:36px;background:var(--bg);color:var(--text);font-family:var(--font);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column;position:relative;border:1px solid rgba(0,0,0,.06)}
.status{height:36px;display:flex;justify-content:space-between;align-items:center;padding:10px 22px 0;font-size:12px;font-weight:600;direction:ltr;color:var(--muted)}
.body{flex:1;direction:rtl;padding:6px 16px 8px;overflow:hidden}
.hello{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.h1{font-size:26px;font-weight:700;letter-spacing:-.02em}
.sub{font-size:12px;color:var(--muted);margin-top:2px}
.menu{width:36px;height:36px;border-radius:12px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--muted)}
.seg{display:flex;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:3px;margin:12px 0}
.seg div{flex:1;text-align:center;font-size:12.5px;padding:7px 0;border-radius:9px;color:var(--muted);font-weight:500}
.seg .on{background:var(--accent);color:#fff;font-weight:700}
.kpis{display:flex;gap:8px}
.kpi{flex:1;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px 6px 7px;text-align:center}
.kpi .l{font-size:11px;color:var(--muted)}
.kpi .v{font-size:15px;font-weight:700;margin-top:2px}
.kpi.profit{border-color:var(--accent)}
.d{font-size:11px;font-weight:700;margin-top:2px}
.good{color:var(--good)}.bad{color:var(--bad)}
.num{direction:ltr;unicode-bidi:isolate;display:inline-block}
.banner{margin-top:10px;background:var(--banner);border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700}
.dot{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none}
.go{margin-inline-start:auto;color:var(--muted)}
.unpaid{font-size:12px;color:var(--muted);margin:6px 4px 0}
.sect{display:flex;justify-content:space-between;align-items:center;margin:12px 2px 6px;font-size:13px;font-weight:700}
.pill{font-size:11px;font-weight:600;color:var(--accent);background:var(--card);border:1px solid var(--line);border-radius:99px;padding:3px 8px}
.row{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin-bottom:6px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:14px}
.name{font-weight:650}
.bar{height:7px;background:var(--line);border-radius:99px;margin-top:6px;display:flex;overflow:hidden}
.bar i{display:block;height:100%}
.bar .exp{background:color-mix(in srgb, var(--muted) 55%, var(--line))}
.bar .pro{background:var(--good)}
.bar .loss{background:var(--bad)}
.row.more .sub,.row.oh .sub{font-size:11px;color:var(--muted)}
.row.oh{border-style:dashed}
.nav{height:74px;border-top:1px solid var(--line);background:var(--card);display:flex;align-items:flex-start;justify-content:space-around;padding-top:8px;direction:rtl;font-size:10px;color:var(--muted);position:relative}
.nav div:first-child{color:var(--accent);font-weight:700}
.plus{width:52px;height:52px;border-radius:50%;background:var(--accent);color:#fff !important;font-size:30px;line-height:48px;text-align:center;margin-top:-22px;font-weight:400}
.rev{position:relative}
.rev span{position:absolute;top:-8px;left:-6px;background:var(--bad);color:#fff;border-radius:99px;font-size:10px;min-width:16px;height:16px;line-height:16px;text-align:center;font-weight:700}
.board{width:1480px;height:1020px;padding:36px 32px;display:flex;gap:28px;background:#e7ebef}
.board .page{width:460px;height:auto;padding:0}
"""

# Dark theme: selected segment text must stay dark on cyan, and the plus label stays dark.
DARK_FIX = """
.phone[style*="#07090C"] .seg .on{color:#062126}
.phone[style*="#07090C"] .dot{color:#062126}
.phone[style*="#07090C"] .plus{color:#062126 !important}
.phone[style*="#F3ECE1"] .seg .on{color:#2A2019}
.phone[style*="#F3ECE1"] .dot{color:#2A2019}
.phone[style*="#F3ECE1"] .plus{color:#2A2019 !important}
"""


def page(inner, w, h, fonts):
    return (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        f"{fonts}\n{CSS}\n{DARK_FIX}\nhtml,body{{width:{w}px;height:{h}px}}"
        f"</style></head><body>{inner}</body></html>"
    )


def main():
    fonts = font_css()
    cards = []
    for theme in THEMES:
        cap = (
            f'<div class="cap">{theme["key"]} · {theme["name"]}'
            f'<br><small>{theme["font"]}</small></div>'
        )
        inner = f'<div class="page">{cap}{phone(theme)}</div>'
        (OUT / f'{theme["id"]}.html').write_text(page(inner, 460, 980, fonts), encoding="utf-8")
        cards.append(inner)
    board = f'<div class="board">{"".join(cards)}</div>'
    (OUT / "style-overview.html").write_text(page(board, 1480, 1020, fonts), encoding="utf-8")
    print("hifi ok")


if __name__ == "__main__":
    main()
