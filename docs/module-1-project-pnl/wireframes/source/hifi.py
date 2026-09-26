# Mercury-inspired Home directions. Example data. Palette choice is pending.
# Writes ui-mercury-p1.html, ui-mercury-p2.html, ui-mercury-p3.html,
# ui-mercury-overview.html, and ui-refs.html next to this file.
# render.sh screenshots them into ../../design/.
import base64
import pathlib
import re
import urllib.request

from palettes import FONT, FONT_LATIN, PALETTES, SURFACE

OUT = pathlib.Path(__file__).parent
FONT_DIR = pathlib.Path("/tmp/fonts")

CSS_URL = (
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Hebrew:wght@400;500;600"
    "&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
)

ROWS = (
    ("בניין מגורים חולון", 80000),
    ("וילה רעננה", 50000),
    ('מגדל משרדים פ"ת', 40000),
    ("בית פרטי כפר סבא", 30000),
    ('שיפוץ דירה ת"א', -10000),
)


def ensure_fonts():
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    css_path = FONT_DIR / "plex.css"
    if not css_path.exists():
        req = urllib.request.Request(CSS_URL, headers={"User-Agent": "Mozilla/5.0"})
        css_path.write_text(urllib.request.urlopen(req, timeout=30).read().decode())
    css = css_path.read_text()
    found = re.findall(
        r"font-family: '([^']+)';\s*font-style: normal;\s*font-weight: (\d+);"
        r"\s*font-display: swap;\s*src: url\(([^)]+)\)",
        css,
    )
    for fam, weight, src in found:
        slug = fam.lower().replace(" ", "-")
        dest = FONT_DIR / f"{slug}-{weight}.ttf"
        if not dest.exists():
            urllib.request.urlretrieve(src, dest)


def font_css():
    ensure_fonts()
    chunks = []
    for fam in (FONT, FONT_LATIN):
        slug = fam.lower().replace(" ", "-")
        for path in sorted(FONT_DIR.glob(f"{slug}-*.ttf")):
            weight = path.stem.rsplit("-", 1)[1]
            if weight not in {"400", "500", "600"}:
                continue
            data = base64.b64encode(path.read_bytes()).decode()
            chunks.append(
                "@font-face{"
                f"font-family:'{fam}';font-weight:{weight};font-style:normal;"
                f"src:url(data:font/ttf;base64,{data}) format('truetype');"
                "}"
            )
    return "\n".join(chunks)


def money(n, tone="ink"):
    sign = "−" if n < 0 else ""
    return f'<span class="num {tone}">{sign}₪{abs(n):,}</span>'


def phone(p):
    rows = []
    for name, profit in ROWS:
        tone = "bad" if profit < 0 else "ink"
        rows.append(
            f'<div class="line"><span class="nm">{name}</span>{money(profit, tone)}</div>'
        )
    body = "\n".join(rows)
    return f'''<div class="phone" style="--accent:{p["accent"]};--ink:{p["ink"]};--secondary:{p["secondary"]};--muted:{p["muted"]};--bg:{p["bg"]};--line:{p["line"]};--good:{p["good"]};--bad:{p["bad"]};--warning:{p["warning"]};--surface:{SURFACE}">
<div class="status"><span>9:41</span><span>▮▮▮</span></div>
<div class="body">
<div class="hello">שלום, יוסי</div>
<div class="kicker">החודש נשאר רווח של</div>
<div class="profit">{money(200000)}</div>
<div class="delta bad">▼ 10%</div>
<div class="pair">
<div><span class="k">הכנסות</span> {money(1310000)} <span class="good">▲ 8%</span></div>
<div><span class="k">הוצאות</span> {money(1110000)} <span class="bad">▲ 12%</span></div>
</div>
<div class="periods"><span class="on">החודש</span><span>חודש קודם</span><span>מתחילת השנה</span></div>
<div class="wait">7 פריטים ממתינים לאישור</div>
<div class="quiet">3 חשבוניות לא שולמו · {money(23400)}</div>
<div class="take">חולון מוביל. ת״א בהפסד.</div>
<div class="card">
{body}
<div class="line"><span class="nm">עוד 12 פרויקטים</span>{money(70000)}</div>
<div class="line oh"><span class="nm">הוצאות כלליות</span>{money(-60000, "bad")}</div>
</div>
</div>
<div class="nav"><div class="on">בית</div><div>פרויקטים</div><div class="add">+</div><div>לאישור</div><div>הגדרות</div></div>
</div>'''


BASE = r"""
*{box-sizing:border-box;margin:0;padding:0}
body{margin:0;background:#ECECEF}
.stage{width:460px;height:980px;padding:24px 32px 0}
.cap{font-family:'IBM Plex Sans',sans-serif;font-size:13px;font-weight:500;color:#3c3c42;margin-bottom:12px;line-height:1.35}
.cap small{font-weight:400;color:#6a6a72}
.phone{width:390px;height:844px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;font-family:'IBM Plex Sans Hebrew','IBM Plex Sans',sans-serif}
.status{height:32px;display:flex;justify-content:space-between;align-items:flex-end;padding:0 20px 4px;font-size:12px;font-weight:500;color:var(--muted);direction:ltr;font-family:'IBM Plex Sans',sans-serif}
.body{flex:1;direction:rtl;padding:8px 16px 8px;min-height:0;overflow:hidden}
.hello{font-size:13px;color:var(--muted)}
.kicker{font-size:15px;color:var(--secondary);margin-top:12px}
.profit{font-size:40px;font-weight:600;letter-spacing:-.03em;line-height:1.1;margin-top:4px}
.delta{font-size:13px;font-weight:500;margin-top:4px}
.pair{display:flex;flex-direction:column;gap:4px;margin-top:16px;font-size:13px;color:var(--ink)}
.pair .k{color:var(--secondary)}
.good{color:var(--good);font-weight:500}
.bad{color:var(--bad);font-weight:500}
.ink{color:var(--ink)}
.num{font-family:'IBM Plex Sans','IBM Plex Sans Hebrew',sans-serif;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;direction:ltr;unicode-bidi:isolate;display:inline-block}
.periods{display:flex;gap:16px;margin-top:16px;font-size:13px;color:var(--secondary)}
.periods .on{color:var(--accent);font-weight:600;border-bottom:2px solid var(--accent);padding-bottom:4px}
.wait{margin-top:12px;font-size:15px;font-weight:500;color:var(--accent)}
.quiet{margin-top:4px;font-size:12px;color:var(--muted)}
.take{margin-top:12px;font-size:15px;font-weight:500;color:var(--ink)}
.card{margin-top:12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.line{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 16px;border-top:1px solid var(--line);font-size:15px}
.line:first-child{border-top:0}
.nm{font-weight:500}
.line.oh .nm{color:var(--secondary);font-weight:400}
.nav{height:64px;flex:none;border-top:1px solid var(--line);background:var(--surface);display:flex;align-items:center;justify-content:space-around;direction:rtl;font-size:12px;color:var(--muted)}
.nav .on{color:var(--ink);font-weight:600}
.add{width:32px;height:32px;border-radius:8px;background:var(--ink);color:#fff;font-size:20px;line-height:30px;text-align:center;font-weight:400;font-family:'IBM Plex Sans',sans-serif}
.board{width:1480px;height:1020px;padding:28px 24px;display:flex;gap:16px;background:#ECECEF}
.board .stage{width:460px;height:auto;padding:0}
.refs{width:1100px;height:720px;background:#F6F6F8;color:#1D1E26;padding:40px;font-family:'IBM Plex Sans Hebrew','IBM Plex Sans',sans-serif}
.refs h1{font-family:'IBM Plex Sans',sans-serif;font-size:20px;font-weight:600}
.refs .lead{margin-top:8px;font-size:15px;color:#565866;max-width:720px}
.refs table{width:100%;border-collapse:collapse;margin-top:24px;background:#fff;border:1px solid #E6E6EC;border-radius:12px;overflow:hidden}
.refs th,.refs td{text-align:left;padding:16px 20px;border-top:1px solid #E6E6EC;font-size:15px;vertical-align:top}
.refs th{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6E7080;border-top:0}
.refs td b{font-weight:600}
.refs .note{margin-top:16px;font-size:13px;color:#565866}
"""


def page(inner, w, h, fonts):
    return (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        f"{fonts}\n{BASE}\nhtml,body{{width:{w}px;height:{h}px}}"
        f"</style></head><body>{inner}</body></html>"
    )


def refs():
    return '''<div class="refs">
<h1>Reference fonts</h1>
<p class="lead">Recorded from live CSS of products the owner pointed at. Flow does not ship those faces, and this board is not their UI.</p>
<table>
<tr><th>Product</th><th>Faces named in CSS</th></tr>
<tr><td>Mercury</td><td><b>Arcadia</b></td></tr>
<tr><td>Morning</td><td><b>Ploni</b> and <b>Ping</b>. Assistant is the fallback.</td></tr>
<tr><td>RiseUp</td><td><b>Simpler Pro</b></td></tr>
<tr><td>Flow</td><td><b>IBM Plex Sans Hebrew</b>, plus <b>IBM Plex Sans</b> for tabular numerals and the shekel sign. Alternative: Assistant.</td></tr>
</table>
<p class="note">Arcadia, Ploni, Ping, and Simpler Pro stay references. The Mercury-inspired direction uses the Flow row.</p>
</div>'''


def main():
    fonts = font_css()
    cards = []
    for p in PALETTES:
        cap = (
            f'<div class="cap">{p["key"]} · {p["name"]}'
            "<br><small>Example data · palette choice pending</small></div>"
        )
        inner = f'<div class="stage">{cap}{phone(p)}</div>'
        (OUT / f'{p["id"]}.html').write_text(page(inner, 460, 980, fonts), encoding="utf-8")
        cards.append(inner)
    board = f'<div class="board">{"".join(cards)}</div>'
    (OUT / "ui-mercury-overview.html").write_text(page(board, 1480, 1020, fonts), encoding="utf-8")
    (OUT / "ui-refs.html").write_text(page(refs(), 1100, 720, fonts), encoding="utf-8")
    print("hifi ok")


if __name__ == "__main__":
    main()
