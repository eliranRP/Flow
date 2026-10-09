# Flow hi-fi generator — design system sheets + 14 screens (light + dark). Run: python3 flow.py && bash render.sh
import json, pathlib
from tokens import COLOR, TYPE, TRACKING, SPACE, RADIUS, FONT, contrast, CHECKS
OUT = pathlib.Path(__file__).parent

# ---------------- icons (Feather-like, 24 grid) ----------------
I = {
 "home": '<path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 20z"/>',
 "folder": '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
 "checkc": '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/>',
 "check": '<polyline points="20 6 9 17 4 12"/>',
 "gear": '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
 "plus": '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
 "chev": '<polyline points="15 18 9 12 15 6"/>',
 "back": '<polyline points="9 18 15 12 9 6"/>',
 "down": '<polyline points="6 9 12 15 18 9"/>',
 "inbox": '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
 "doc": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
 "bell": '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
 "search": '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
 "camera": '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
 "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
 "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
 "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
 "split": '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.2-2.8L3 3"/><path d="m15 9 6-6"/>',
 "move": '<path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>',
 "more": '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
 "trash": '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>',
 "bank": '<path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M5 10v11"/><path d="M19 10v11"/><path d="M9.5 14v3"/><path d="M14.5 14v3"/>',
 "spark": '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
 "x": '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
 "cal": '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
 "grip": '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
 "phone": '<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/>',
 "logout": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
 "share": '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
 "addsq": '<rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
 "clock": '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
 "info": '<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11.5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
 "repeat": '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
 "tag": '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>',
 "wifioff": '<line x1="2" y1="2" x2="22" y2="22"/><path d="M16.7 11.1A11 11 0 0 1 19 12.6"/><path d="M5 12.6a11 11 0 0 1 5.2-2.4"/><path d="M10.7 5.1A16 16 0 0 1 22.6 9"/><path d="M1.4 9a16 16 0 0 1 4.7-2.9"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r=".6" fill="currentColor"/>',
 "refresh": '<polyline points="21 4 21 10 15 10"/><path d="M20 15a8.5 8.5 0 1 1-1.9-8.9L21 10"/>',
 "belloff": '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A18 18 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><line x1="2" y1="2" x2="22" y2="22"/>',
 "chart": '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
 "transfer": '<polyline points="17 3 21 7 17 11"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 13 3 17 7 21"/><line x1="3" y1="17" x2="15" y2="17"/>',
}
def ic(n, s=22, w=1.9, cls=""):
    return f'<svg class="ic {cls}" width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round">{I[n]}</svg>'
def num(v, sign=False):
    s = f"₪{abs(v):,}"
    if v < 0: s = "−" + s
    elif sign and v > 0: s = "+" + s
    return f'<span class="n">{s}</span>'
def n(t): return f'<span class="n">{t}</span>'
def spin(s=20, w=2.5):  # loading spinner: faint track + arc, rotates (paused in static renders)
    return f'<svg class="spin" width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{w}" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity=".28"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>'
def sk(w, h=12, r=6, extra=""):  # skeleton placeholder block
    return f'<i class="sk" style="width:{w}{"px" if isinstance(w,int) else ""};height:{h}px;border-radius:{r}px;{extra}"></i>'

STATUS = '''<div class="sb"><span class="tm">9:41</span><span class="island"></span><span class="sbr">
<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0z M3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.3 1.3a4.6 4.6 0 0 0-6.6 0z M1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.3 1.3a7.8 7.8 0 0 0-11 0z" fill="currentColor"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor"/><rect x="24.5" y="4.5" width="2" height="4" rx="1" fill="currentColor" opacity=".45"/></svg></span></div>'''

# App icon S1 (decision 0031): the Rubik 700 F from the wordmark, 50% of the tile, on a 100x100 grid. Source: flow-logo/final/icon/flow-icon-brand.svg
APP_F_PATH = "M35.07 75 C34.07 75 33.29 74.21 33.29 73.21 L33.29 26.79 C33.29 25.79 34.07 25 35.07 25 L67.93 25 C68.93 25 69.71 25.79 69.71 26.79 L69.71 34 C69.71 35 68.93 35.79 67.93 35.79 L45.86 35.79 L45.86 46.29 L66.5 46.29 C67.5 46.29 68.29 47.07 68.29 48.07 L68.29 55.29 C68.29 56.29 67.5 57.07 66.5 57.07 L45.86 57.07 L45.86 73.21 C45.86 74.21 45.07 75 44.07 75 Z"
APPF = f'<svg viewBox="0 0 100 100" aria-hidden="true"><path fill="currentColor" d="{APP_F_PATH}"/></svg>'
def appic(px=72, r=18):
    return f'<span class="appic" style="width:{px}px;height:{px}px;border-radius:{r}px" role="img" aria-label="Flow">{APPF}</span>'

def vars_css(mode):
    return ":root{" + ";".join(f"--{k}:{v}" for k, v in COLOR[mode].items()) + "}"

BASE = '''
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Rubik",system-ui,sans-serif;font-weight:500;background:var(--bg);color:var(--text);direction:rtl;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.n{font-variant-numeric:tabular-nums lining-nums;direction:ltr;unicode-bidi:isolate}
.scr{width:390px;height:844px;overflow:hidden;position:relative;background:var(--bg)}
.scr.tall{height:auto;min-height:844px;padding-bottom:100px}
.sb{height:47px;display:flex;align-items:center;justify-content:space-between;padding-block:0;padding-inline:30px 28px;direction:ltr;font-weight:600;font-size:16px;font-family:system-ui,sans-serif;color:var(--text)}
.sb .island{width:122px;height:34px;border-radius:20px;background:#000} .sb .sbr{display:flex;gap:6px;align-items:center}
.band .sb{color:var(--on-band)}
.pad{padding:0 24px}
.ex{font-size:13px;color:var(--text-muted);font-weight:400}
.hint{font-size:13px;color:var(--text-muted);font-weight:400;line-height:1.45}
.lbl{font-size:15px;color:var(--text-secondary);font-weight:500}
.t1{font-size:28px;font-weight:600;line-height:1.3} .t2{font-size:22px;font-weight:600;line-height:1.35} .t3{font-size:17px;font-weight:600;line-height:1.45}
.acc{color:var(--accent-text)} .good{color:var(--good)} .bad{color:var(--bad)} .warn{color:var(--warning)}
/* top bars */
.top{display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 12px}
.iconbtn{width:44px;height:44px;display:grid;place-items:center;color:var(--text);border-radius:9999px}
.top .ex{padding:0 12px}
.head{padding:4px 24px 0} .head .lbl{margin-top:2px}
/* band */
.band{background:var(--band);color:var(--on-band);border-radius:0 0 28px 28px;padding-bottom:28px}
.band .lbl,.band .ex,.band .hint{color:var(--on-band-secondary)} .band .iconbtn{color:var(--on-band)}
.wm{font-size:22px;font-weight:700;letter-spacing:-.01em;direction:ltr} .wm.logo{color:var(--logo)}
.hd{display:flex;align-items:center;justify-content:space-between;padding:12px 24px 0}
.gr{display:flex;justify-content:space-between;align-items:baseline;padding:4px 24px 0;font-size:15px}
.hero{padding:28px 24px 0}
.big{font-size:52px;font-weight:600;letter-spacing:-.02em;line-height:1.15;margin-top:6px}
.dl{font-size:15px;margin-top:8px;display:flex;align-items:center;gap:8px}
.ie{padding:20px 24px 0;font-size:15px;display:flex;gap:24px}
.ie b{font-weight:500;color:var(--on-band);margin-inline-start:6px}
/* period pill + delta pill */
.per{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 12px 0 10px;border-radius:9999px;background:var(--tint);font-size:15px;color:var(--text)}
.per .ic{color:var(--accent-text)}
.band .per{background:var(--band-pill);color:var(--text)}
.delta{display:inline-flex;align-items:center;gap:4px;background:var(--band-chip);border-radius:9999px;padding:1px 10px;font-weight:600;font-size:15px}
.delta.dn{color:var(--bad)} .delta.up{color:var(--good)}
.delta.flat{background:var(--tint)}
/* cards + rows */
.card{background:var(--tint);border-radius:16px;margin:0 16px;padding-block:16px;padding-inline:16px 12px;display:flex;align-items:center;gap:14px}
.card .ic{color:var(--accent-text);flex:none} .card .tx{flex:1} .card .cv{color:var(--text-muted);display:grid;flex:none}
.box{background:var(--surface);border:1px solid var(--line);border-radius:16px;margin:0 16px}
.sec{padding:36px 24px 0} .sec h2{font-size:17px;font-weight:600;margin-bottom:4px} .sechd{display:flex;justify-content:space-between;align-items:baseline}
.pr{display:flex;justify-content:space-between;align-items:center;padding:14px 0;gap:12px}
.pr .nm{font-size:17px} .pr .amt{font-size:17px;font-weight:600;white-space:nowrap}
.pr.tx .nm{font-size:16px}
.rows>.pr+.pr{border-top:1px solid var(--line)}
.lnk{display:inline-flex;align-items:center;gap:2px;font-size:15px;color:var(--accent-text);font-weight:500}
.lnk.q{color:var(--text-secondary)} .lnk .ic{color:currentColor}
.rowi{display:flex;align-items:center;gap:14px;padding:14px 0}
.rowi>.ic{color:var(--text-secondary);flex:none} .rowi>.ic.acc{color:var(--accent-text)} .rowi.bad>.ic{color:var(--bad)} .rowi .tx{flex:1} .rowi .cv{color:var(--text-muted);display:grid}
.list .rowi+.rowi{border-top:1px solid var(--line)}
.grp{font-size:13px;color:var(--text-muted);font-weight:500;padding:28px 24px 4px}
/* buttons */
.btn{height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:16px;font-weight:600;width:100%;border:0}
.btn.pri{background:var(--accent);color:var(--on-accent)}
.btn.sec{background:var(--tint);color:var(--accent-text);padding:0 16px}
.btn.gho{background:transparent;color:var(--accent-text)}
.btn.dng{background:transparent;color:var(--bad)}
.btn.sm{display:inline-flex;height:36px;width:auto;padding:0 14px;border-radius:9999px;font-size:15px}
.btn.dis{background:var(--disabled-bg);color:var(--disabled-text)}
.btn.dngs{background:var(--bad-tint);color:var(--bad)}
.acts{padding:0 24px;display:flex;flex-direction:column;gap:8px}
/* fab + tab bar */
.fab{width:48px;height:48px;border-radius:9999px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center}
.tb{position:absolute;bottom:0;inset-inline:0;height:86px;background:var(--surface);border-top:1px solid var(--line);display:flex;justify-content:space-around;padding:8px 8px 0}
.ti{width:64px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:var(--text-muted);position:relative;font-weight:500}
.ti.on{color:var(--accent-text)}
.bd{position:absolute;top:-3px;inset-inline-end:14px;min-width:17px;height:17px;border-radius:9999px;background:var(--badge-bg);color:var(--badge-text);font-size:11px;display:grid;place-items:center;padding:0 4px}
.hi{position:absolute;bottom:8px;inset-inline:0;margin-inline:auto;width:134px;height:5px;border-radius:3px;background:var(--text)}
/* chips */
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:9999px;font-size:15px;background:var(--surface);border:1px solid var(--control-border);color:var(--text)}
.chip.sug{background:var(--tint);border-color:transparent;color:var(--text)} .chip.sug .ic{color:var(--accent-text)}
.chip.on{background:var(--accent);border-color:transparent;color:var(--on-accent)}
.chip .hint{font-size:13px} .chip.on .hint{color:var(--on-accent);opacity:1}
.stat{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border-radius:9999px;background:var(--tint);font-size:13px;color:var(--text)}
.stat .ic{color:var(--accent-text)}
/* segmented */
.seg{display:flex;background:var(--tint);border-radius:12px;padding:3px;gap:2px}
.seg span{flex:1;height:36px;display:grid;place-items:center;border-radius:9px;font-size:15px;color:var(--text-secondary)}
.seg span.on{background:var(--seg-on);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(20,10,40,.12)}
/* inputs */
.fld{display:flex;flex-direction:column;gap:6px} .fld label{font-size:13px;color:var(--text-secondary);font-weight:400}
.inp{height:52px;border-radius:12px;background:var(--surface);border:1px solid var(--control-border);display:flex;align-items:center;gap:10px;padding:0 14px;font-size:16px;color:var(--text)}
.inp.focus{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)} .inp .ph{color:var(--text-muted);font-weight:400} .inp .ic{color:var(--text-muted)}
.search{background:var(--surface);border:1px solid var(--control-border);height:46px}
/* switch */
.sw{display:inline-block;width:46px;height:28px;border-radius:9999px;background:var(--control-off);position:relative;flex:none}
.sw i{position:absolute;top:3px;inset-inline-start:3px;width:22px;height:22px;border-radius:9999px;background:var(--knob);box-shadow:0 1px 2px rgba(0,0,0,.25)}
.sw.on{background:var(--accent)} .sw.on i{inset-inline-start:21px;background:var(--knob-on)}
.chk{width:24px;height:24px;border-radius:7px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;flex:none}
.chk.off{background:transparent;border:1.5px solid var(--control-border)}
/* sheet */
.scrim{position:absolute;inset:0;background:var(--scrim)}
.under{position:absolute;inset:0;border:0;width:390px;height:844px}
.sheet{position:absolute;inset-inline:0;bottom:0;background:var(--surface);border-radius:24px 24px 0 0;padding:8px 0 34px}
.grab{width:40px;height:5px;border-radius:3px;background:var(--control-off);margin:0 auto 12px}
.shd{display:flex;justify-content:space-between;align-items:flex-start;padding:4px 24px 0}
/* toast */
.toast{display:flex;align-items:center;gap:10px;background:var(--toast-bg);color:var(--toast-text);border-radius:14px;padding:12px 16px;font-size:15px}
.toast .u{margin-inline-start:auto;font-weight:600;color:var(--toast-text);text-decoration:underline}
/* empty */
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:24px}
.empty>.ic{color:var(--text-muted)}
/* progress */
.prog{height:6px;border-radius:9999px;background:var(--tint);overflow:hidden;display:flex} .prog i{background:var(--accent);border-radius:9999px}
/* empty state · large (full screen) */
.empty.lg{gap:0;padding:0 40px} .empty.lg .eic{width:80px;height:80px;border-radius:9999px;background:var(--tint);color:var(--text-muted);display:grid;place-items:center;margin-bottom:20px}
.empty.lg .t2{font-size:22px} .empty.lg .ln{font-size:15px;color:var(--text-secondary);font-weight:400;margin-top:6px;max-width:300px} .empty.lg .btn{margin-top:24px}
.empty.lg .btn.pri,.empty.lg .btn.sec{width:auto;padding:0 24px}
.fillc{position:absolute;inset-inline:0;display:flex;align-items:center;justify-content:center}
/* calendar (date picker) */
.calh{display:flex;align-items:center;justify-content:space-between;padding:0 12px}
.calh .iconbtn.off{color:var(--disabled-text)}
.wk,.days{display:grid;grid-template-columns:repeat(7,1fr);padding:0 16px}
.wk span{height:32px;display:grid;place-items:center;font-size:13px;color:var(--text-muted);font-weight:500}
.d{position:relative;height:44px;display:grid;place-items:center;font-size:16px;font-variant-numeric:tabular-nums}
.d b{position:relative;z-index:1;width:40px;height:40px;border-radius:9999px;display:grid;place-items:center;font-weight:500}
.d.today b{box-shadow:inset 0 0 0 1.5px var(--accent-text);color:var(--accent-text);font-weight:600}
.d.sel b{background:var(--accent);color:var(--on-accent);font-weight:600;box-shadow:none}
.d.off b{color:var(--disabled-text);font-weight:400}
.d.mid::before,.d.rs::before,.d.re::before{content:"";position:absolute;top:2px;bottom:2px;background:var(--tint)}
.d.mid::before{inset-inline:0} .d.rs::before{inset-inline-start:50%;inset-inline-end:0} .d.re::before{inset-inline-start:0;inset-inline-end:50%}
/* option rows (period sheet, pick target) */
.opt{display:flex;align-items:center;gap:14px;padding:14px 0}
.opt .tx{flex:1} .opt .rd{width:22px;height:22px;border-radius:9999px;border:1.5px solid var(--control-border);flex:none}
.opt .rd.on{border:0;background:var(--accent);color:var(--on-accent);display:grid;place-items:center}
.list .opt+.opt{border-top:1px solid var(--line)}
/* Sign in with Google (Google branding: light theme in both modes, pill, standard G, Roboto Medium; Hebrew falls back to Rubik) */
.gsi{height:52px;border-radius:9999px;background:var(--gsi-bg);border:1px solid var(--gsi-border);color:var(--gsi-text);display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding-inline:16px;font-family:"Roboto","Rubik",system-ui,sans-serif;font-weight:500;font-size:16px;position:relative}
.gsi .g{width:20px;height:20px;flex:none;display:block}
.gsi.press{background:linear-gradient(rgba(31,31,31,.12),rgba(31,31,31,.12)),var(--gsi-bg)}
.gsi.foc{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--focus)}
.gsi.load{color:rgba(31,31,31,.6)}
.gsi.dis{background:rgba(255,255,255,.38);border-color:rgba(31,31,31,.12);color:rgba(31,31,31,.38)} .gsi.dis .g{opacity:.38}
.note{display:flex;gap:12px;align-items:flex-start;background:var(--tint);border-radius:16px;padding:14px 16px}
.note .ni{display:grid;color:var(--accent-text);padding-top:2px} .note.bad .ni{color:var(--bad)}
.note .nt{font-weight:600;font-size:16px;color:var(--text)} .note .nl{font-size:15px;color:var(--text-secondary);font-weight:400;margin-top:2px}
.msg-e{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--error);font-weight:400}
/* file chip, app icon, step tiles */
.filechip{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:9999px;border:1px solid var(--control-border);font-size:15px;color:var(--text-secondary)}
.appic{width:72px;height:72px;border-radius:18px;background:var(--band);color:var(--on-band);display:block;overflow:hidden;flex:none} .appic svg{display:block;width:100%;height:100%}
.tile{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--tint);color:var(--accent-text);vertical-align:middle;margin-inline:4px}
.stepn{width:28px;height:28px;border-radius:9999px;background:var(--tint);color:var(--accent-text);display:grid;place-items:center;font-size:13px;font-weight:600;flex:none}
/* breakdown (overhead) */
.bk .pr{padding:12px 0} .bk .pr .amt{font-size:16px;font-weight:500} .bk .tot{border-top:1px solid var(--line)} .bk .tot .nm,.bk .tot .amt{font-weight:600;font-size:17px}
/* skeleton + loading */
.sk{display:block;flex:none;background-color:var(--skeleton);background-image:linear-gradient(105deg,var(--skeleton) 35%,var(--skeleton-shine) 50%,var(--skeleton) 65%);background-attachment:fixed;background-size:200% 100%;background-position:40% 0;animation:shim 1.6s linear infinite}
.band .sk{background-color:var(--skeleton-band);background-image:linear-gradient(105deg,var(--skeleton-band) 35%,var(--skeleton-band-shine) 50%,var(--skeleton-band) 65%)}
@keyframes shim{from{background-position:100% 0}to{background-position:-100% 0}}
.spin{animation:rot .9s linear infinite;flex:none} @keyframes rot{to{transform:rotate(360deg)}}
.still .sk,.still .spin{animation:none}
.btn.load{opacity:1} .btn.pri.load{background:var(--accent-pressed)}
.ptr{height:56px;display:grid;place-items:center} .ptr span{width:36px;height:36px;border-radius:9999px;background:var(--band-pill);color:var(--accent-text);display:grid;place-items:center;box-shadow:0 1px 3px rgba(20,10,40,.18)}
.banner{display:flex;align-items:center;gap:10px;margin:0 16px;padding-block:10px;padding-inline:14px 12px;border-radius:14px;background:var(--tint);font-size:15px}
.banner .ic{color:var(--text-secondary);flex:none} .banner .u{margin-inline-start:auto;color:var(--accent-text);font-weight:600;white-space:nowrap}
.steps .rowi{padding:12px 0} .steps .dot{width:22px;height:22px;display:grid;place-items:center;flex:none;color:var(--accent-text)} .steps .wait{color:var(--text-muted)} .steps .wait .o{width:14px;height:14px;border-radius:9999px;border:1.5px solid var(--control-off)}
'''

def tabbar(active="home", badge=7):
    items = [("home", "home", "בית"), ("proj", "folder", "פרויקטים"), None, ("rev", "checkc", "לאישור"), ("set", "gear", "הגדרות")]
    out = ""
    for it in items:
        if it is None: out += f'<div class="ti"><span class="fab">{ic("plus",24,2.4)}</span></div>'; continue
        k, icon, lab = it
        b = f'<span class="bd"><span class="n">{badge}</span></span>' if k == "rev" and badge else ""
        out += f'<div class="ti{" on" if k == active else ""}">{ic(icon,24,1.9)}{b}{lab}</div>'
    return f'<div class="tb">{out}<span class="hi"></span></div>'

def doc(title, body, mode, extra="", w=390):
    return f'''<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>{title}</title>
<!-- production: <link href="{FONT["google"]}" rel="stylesheet"> -->
<style>{vars_css(mode)}{BASE}body{{width:{w}px}}{extra}</style></head><body>{body}</body></html>'''

EXTAG = '<span class="ex">נתוני דוגמה · Example data</span>'
def topbar(title="", back=True, right="", close=False):
    l = ic("back", 24, 2) if back else ""
    if close: l = ic("x", 24, 2)
    return f'<div class="top"><span class="iconbtn">{l}</span>{f"<span class=t3>{title}</span>" if title else ""}<span style="display:flex;align-items:center">{EXTAG if not right else ""}{right}</span></div>'

# ---------------- data ----------------
PROJ = [("בניין מגורים חולון",300000,220000),("וילה רעננה",180000,130000),('מגדל משרדים פ"ת',250000,210000),("בית פרטי כפר סבא",120000,90000),('שיפוץ דירה ת"א',60000,70000)]
T_INC, T_EXP = 1310000, 1110000

# ---------------- screens ----------------
S = {}
def screen(fid):
    def deco(fn): S[fid] = fn; return fn
    return deco

@screen("01-home")
def home(mode):
    top3 = sorted(PROJ, key=lambda p: p[1]-p[2], reverse=True)[:3]
    rows = "".join(f'<div class="pr"><div><div class="nm">{nm}</div><div class="hint">רווחיות {n(str(round((i-e)/i*100))+"%")}</div></div><div class="amt">{num(i-e)}</div></div>' for nm, i, e in top3)
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="hd"><span class="wm">Flow</span><span class="per">החודש {ic("down",16,2.25)}</span></div>
<div class="gr"><span class="lbl">בוקר טוב, אלירן</span>{EXTAG}</div>
<div class="hero"><div class="lbl">רווח בספטמבר</div><div class="big">{num(T_INC-T_EXP)}</div>
<div class="dl"><span class="delta dn">▼ {n("10%")}</span><span class="lbl">מחודש שעבר</span></div></div>
<div class="ie lbl"><span>הכנסות<b>{num(T_INC)}</b></span><span>הוצאות<b>{num(T_EXP)}</b></span></div></div>
<div class="card" style="margin-top:24px">{ic("inbox",22,1.9)}<div class="tx"><div style="font-size:17px">{n(7)} פריטים ממתינים לאישור</div><div class="hint">{n(3)} חשבוניות פתוחות · {num(23400)}</div></div><span class="cv">{ic("chev",20,2)}</span></div>
<div class="sec"><h2>פרויקטים מובילים</h2>{rows}<div class="lnk q" style="margin-top:4px">לכל הפרויקטים {ic("chev",16,2)}</div></div>
{tabbar("home")}</div>'''

@screen("02-project")
def project(mode):
    cats = [("חומרים",300000),("קבלני משנה",220000),("עבודה",120000)]
    rows = "".join(f'<div class="pr"><div class="nm">{c}</div><div class="amt">{num(v)}</div></div>' for c, v in cats)
    return f'''<div class="scr"><div class="band">{STATUS}
<div class="top"><span class="iconbtn">{ic("back",24,2)}</span><span style="display:flex;align-items:center">{EXTAG}<span class="iconbtn">{ic("more",24,2)}</span></span></div>
<div class="pad"><div class="t2">וילה רעננה</div><div class="lbl">משפ׳ כהן · מתחילת הפרויקט</div></div>
<div class="hero" style="padding-top:22px"><div class="lbl">רווח · רווחיות {n("20%")}</div><div class="big" style="font-size:36px">{num(180000)}</div></div>
<div class="ie lbl"><span>הכנסות<b>{num(900000)}</b></span><span>הוצאות<b>{num(720000)}</b></span></div></div>
<div class="pad" style="margin-top:20px;display:flex;align-items:center;gap:12px"><div style="flex:1"><div>אחרי חלק בהוצאות כלליות</div><div class="hint">כבוי · מציג רווח לפני כלליות</div></div><span class="sw"><i></i></span></div>
<div class="sec"><div class="sechd"><h2>תקציב</h2><span class="hint">{num(720000)} מתוך {num(1000000)}</span></div>
<div class="prog" style="margin-top:8px"><i style="width:72%"></i></div><div class="hint" style="margin-top:6px">נוצלו {n("72%")} מהתקציב</div></div>
<div class="sec"><div class="sechd"><h2>הוצאות לפי קטגוריה</h2></div><div class="rows">{rows}</div>
<div style="display:flex;justify-content:space-between;margin-top:2px"><span class="lnk q">כל הקטגוריות {ic("chev",16,2)}</span><span class="lnk">תנועות אחרונות {ic("chev",16,2)}</span></div></div>
{tabbar("proj")}</div>'''

@screen("03-review")
def review(mode):
    return f'''<div class="scr">{STATUS}{topbar(back=False)}
<div class="head" style="padding-top:0"><div class="t1">לאישור</div><div class="lbl">רק מה שה־AI לא היה בטוח בו</div></div>
<div class="pad" style="margin-top:16px;display:flex;align-items:center;gap:12px"><div class="prog" style="flex:1"><i style="width:43%"></i></div><span class="hint">{n(3)} מתוך {n(7)}</span></div>
<div class="card" style="margin-top:16px;padding:12px 14px">{ic("checkc",20,1.9)}<div class="tx" style="font-size:15px">{n(12)} תנועות אושרו אוטומטית היום</div><span class="lnk">צפייה</span><span class="cv">{ic("x",18,2)}</span></div>
<div class="box" style="margin-top:20px;padding:20px">
 <div style="display:flex;gap:14px;align-items:flex-start"><div style="width:52px;height:64px;border-radius:10px;background:var(--tint);display:grid;place-items:center;color:var(--accent-text);flex:none">{ic("doc",24,1.8)}</div>
 <div style="flex:1"><div class="t3">חומרי בניין השרון בע״מ</div><div class="hint">חשבונית מצולמת · {n("21/09/2026")}</div></div></div>
 <div class="display n" style="font-size:36px;font-weight:600;margin-top:16px;line-height:1.2">{num(8500)}</div><div class="hint">לפני מע״מ · מע״מ {num(1530)}</div>
 <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px"><div class="hint" style="display:flex;align-items:center;gap:6px"><span class="acc">{ic("spark",16,1.9)}</span>הצעת AI</div>
 <div style="display:flex;justify-content:space-between;margin-top:8px"><span class="lbl">פרויקט</span><span>וילה רעננה <span class="hint">{n("92%")}</span></span></div>
 <div style="display:flex;justify-content:space-between;margin-top:6px"><span class="lbl">קטגוריה</span><span>חומרים <span class="hint">{n("95%")}</span></span></div></div>
</div>
<div class="acts" style="margin-top:20px"><div class="btn pri">{ic("check",20,2.4)}אישור</div><div style="display:flex;gap:8px"><div class="btn sec">שינוי</div><div class="btn gho">דלג</div></div></div>
{tabbar("rev")}</div>'''

@screen("04-add")
def add(mode):
    opts = [("camera","צילום חשבונית","מצלמה או PDF · קורא ספק, סכום, מע״מ ותאריך"),("upload","העלאת דוח בנק","קובץ Excel מאפליקציית פועלים"),("edit","הזנה ידנית","סכום, פרויקט וקטגוריה – רק במקרה הצורך")]
    rows = "".join(f'<div class="rowi" style="padding:18px 0"><span class="acc" style="flex:none">{ic(i,26,1.8)}</span><div class="tx"><div class="t3" style="font-weight:600">{t}</div><div class="hint">{h}</div></div><span class="cv">{ic("chev",20,2)}</span></div>' for i, t, h in opts)
    return f'''<div class="scr"><iframe class="under" src="01-home-{mode}.html" scrolling="no"></iframe><div class="scrim"></div>
<div class="sheet"><div class="grab"></div><div class="shd"><div><div class="t2">הוספה</div><div class="lbl">ה־AI ישייך לפרויקט ולקטגוריה – נשאר רק לאשר</div></div><span class="iconbtn" style="margin-block-start:-6px;margin-inline-start:-12px">{ic("x",22,2)}</span></div>
<div class="pad list" style="margin-top:8px">{rows}</div><div class="acts" style="margin-top:8px"><div class="btn gho" style="color:var(--text-secondary)">ביטול</div></div></div></div>'''

@screen("05-projects")
def projects(mode):
    data = [("בניין מגורים חולון","א.ב. נכסים",350000),("מגדל משרדים פ\"ת","ש.ר. יזמות",210000),("וילה רעננה","משפ׳ כהן",180000),("בית פרטי כפר סבא","י. מזרחי",95000),("גן יבנה – תוספת קומה","משפ׳ דהן",12000),("שיפוץ דירה ת\"א","משפ׳ לוי",-15000)]
    rows = "".join(f'<div class="pr"><div><div class="nm">{a}</div><div class="hint">{c}</div></div><div class="amt{" bad" if v < 0 else ""}">{num(v)}</div></div>' for a, c, v in data)
    return f'''<div class="scr">{STATUS}{topbar(back=False)}
<div class="head" style="padding-top:0"><div style="display:flex;justify-content:space-between;align-items:center"><div class="t1">פרויקטים</div><span class="btn sm sec">{ic("plus",16,2.4)}פרויקט חדש</span></div><div class="lbl">{n(17)} פעילים · רווח מתחילת הפרויקט</div></div>
<div class="pad" style="margin-top:16px"><div class="inp search">{ic("search",20,2)}<span class="ph">חיפוש פרויקט או לקוח</span></div></div>
<div class="pad rows" style="margin-top:8px">{rows}</div>
<div class="pad"><div class="lnk q" style="margin-top:6px"><span>עוד {n(11)} פעילים · {n(21)} הסתיימו</span> {ic("chev",16,2)}</div></div>
{tabbar("proj")}</div>'''

@screen("06-change-sheet")
def change(mode):
    recent = [("P-14",'מגדל משרדים פ"ת',"היום"),("P-21","בית פרטי כפר סבא","לפני 3 ימים"),("P-03",'שיפוץ דירה ת"א',"לפני שבוע")]
    rr = "".join(f'<div class="pr" style="padding:11px 0"><div class="nm" style="font-size:16px"><span class="hint" style="margin-inline-end:8px"><span class="n">{c}</span></span>{nm}</div><span class="hint">{t}</span></div>' for c, nm, t in recent)
    return f'''<div class="scr"><iframe class="under" src="03-review-{mode}.html" scrolling="no"></iframe><div class="scrim"></div>
<div class="sheet" style="top:56px;padding-bottom:0"><div class="grab"></div>
<div class="shd"><div><div class="t2">שינוי שיוך</div><div class="lbl">חומרי בניין השרון · {num(8500)}</div></div><span class="iconbtn" style="margin-block-start:-6px;margin-inline-start:-12px">{ic("x",22,2)}</span></div>
<div class="pad" style="margin-top:20px"><div class="t3">פרויקט</div>
<div class="chips" style="margin-top:10px"><span class="chip on">{ic("spark",15,2)}בניין מגורים חולון</span><span class="chip sug">וילה רעננה <span class="hint">אחרון</span></span></div>
<div class="inp search" style="margin-top:12px">{ic("search",20,2)}<span class="ph">חיפוש פרויקט או קוד (P-12)</span></div>
<div class="rows" style="margin-top:2px">{rr}</div>
<div style="display:flex;justify-content:space-between"><span class="lnk">{ic("plus",16,2.2)} פרויקט חדש</span><span class="lnk">{ic("split",16,2)} פיצול בין פרויקטים</span></div></div>
<div class="pad" style="margin-top:24px"><div class="t3">קטגוריה</div><div class="chips" style="margin-top:10px"><span class="chip on">{ic("check",15,2.4)}חומרים</span><span class="chip">ציוד והשכרה</span><span class="chip">הובלה</span><span class="chip">עוד…</span></div></div>
<div class="pad" style="margin-top:22px;display:flex;align-items:center;gap:12px"><div style="flex:1"><div>לזכור לספק הזה</div><div class="hint">השרון ← בניין מגורים חולון · חומרים</div></div><span class="sw on"><i></i></span></div>
<div class="acts" style="position:absolute;bottom:34px;inset-inline:0"><div class="btn pri">{ic("check",20,2.4)}שמירה ואישור</div></div></div></div>'''

@screen("07-categories")
def categories(mode):
    cats = [("חומרים",124),("קבלני משנה",38),("עבודה",52),("ציוד והשכרה",17),("הובלה",21),("ביטוח",4),("אחר",9)]
    rows = "".join(f'<div class="rowi" style="padding:12px 0"><span style="color:var(--text-muted);flex:none;display:grid">{ic("grip",20,2)}</span><div class="tx">{c}</div><span class="hint">{n(k)} תנועות</span><span class="iconbtn" style="width:32px;color:var(--text-secondary)">{ic("more",20,2)}</span></div>' for c, k in cats)
    return f'''<div class="scr">{STATUS}{topbar()}
<div class="head" style="padding-top:0"><div class="hint">הגדרות</div><div class="t1">קטגוריות</div></div>
<div class="pad" style="margin-top:16px"><div class="seg"><span class="on">הוצאות</span><span>הכנסות</span></div></div>
<div class="pad list" style="margin-top:8px">{rows}</div>
<div class="pad" style="display:flex;justify-content:space-between;margin-top:4px"><span class="lnk">{ic("plus",16,2.2)} קטגוריה חדשה</span><span class="lnk q"><span>מוסתרות · {n(1)}</span> {ic("down",16,2)}</span></div>
{tabbar("set")}</div>'''

@screen("08-upload-results")
def upload(mode):
    items = [("checkc","acc",f"{n(33)} אושרו אוטומטית",f"{n(18)} הותאמו לחשבוניות · {n(15)} לפי כללים שלמדנו"),("transfer","",f"{n(2)} העברות בין החשבונות שלך","הוסרו – לא נספרות ברווח"),("inbox","acc",f"{n(7)} ממתינות לאישור","ה־AI לא היה בטוח – צריך את האישור שלך")]
    rows = "".join(f'<div class="rowi" style="padding:16px 0">{ic(i,22,1.9,c)}<div class="tx"><div>{t}</div><div class="hint">{h}</div></div></div>' for i, c, t, h in items)
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="head" style="padding-top:0"><div class="t1">דוח בנק הועלה</div><div class="lbl"><bdi>פועלים_ספטמבר.xlsx</bdi> · {n("01–30/09")}</div><div class="hint">בנק הפועלים · חשבון {n("12-345-678901")}</div></div>
<div class="pad" style="margin-top:36px"><div class="big" style="font-size:36px;line-height:1.2;margin:0">{n(42)}</div><div class="lbl">שורות נקלטו</div></div>
<div class="pad list" style="margin-top:12px">{rows}</div>
<div class="card" style="margin-top:8px;padding:12px 14px">{ic("info",20,1.9)}<div class="tx" style="font-size:15px">{n(3)} חשבוניות פתוחות <span class="hint">· לא נספרות ברווח</span></div><span class="cv">{ic("chev",18,2)}</span></div>
<div class="acts" style="margin-top:24px"><div class="btn pri"><span>לאשר {n(7)} פריטים</span></div><div class="btn gho" style="height:40px"><span>הצגת כל {n(42)} השורות</span></div></div>
{tabbar("home")}</div>'''

# ---- onboarding (5 steps) ----
def ob_frame(step, body, cta, sec=""):
    stp = f'<div class="pad" style="margin-top:4px;display:flex;align-items:center;gap:12px"><div class="prog" style="flex:1;height:4px"><i style="width:{step*25}%"></i></div><span class="hint">שלב {n(step)} מתוך {n(4)}</span></div>' if step else ""
    return f'''<div class="scr">{STATUS}{topbar(back=bool(step))}{stp}{body}
<div class="acts" style="position:absolute;bottom:34px;inset-inline:0"><div class="btn pri">{cta}</div>{sec}</div></div>'''
# Google "G" (standard multicolour mark, unmodified)
GLOGO = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'
def gbtn(state=""):
    """Sign in with Google. state: '' | press | foc | load | dis"""
    lead = spin(20, 2.5) if state == "load" else GLOGO
    txt = "מתחברים…" if state == "load" else "המשך עם Google"
    return f'<div class="gsi {state}" role="button">{lead}<span>{txt}</span></div>'
def signin(mode, notice="", state="", extra=""):
    """09a sign-in (Google only). notice = inline note above the button (error screens)."""
    return f'''<div class="scr">{STATUS}
<div class="pad" style="margin-top:132px"><div class="wm logo" style="font-size:44px;display:inline-block">Flow</div>
<div class="lbl" style="margin-top:6px;font-size:17px">הרווח וההפסד של העסק, בלי אקסלים</div></div>
<div style="position:absolute;bottom:34px;inset-inline:0" class="pad">{notice}
<div class="t2" style="margin-top:{24 if notice else 0}px">כניסה או הרשמה</div><div class="lbl" style="margin-top:2px">בלי סיסמה – עם חשבון Google שכבר יש לך</div>
<div style="margin-top:20px">{gbtn(state)}</div>{extra}
<div class="hint" style="margin-top:16px;text-align:center">נקבל מ־Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.<br><span style="text-decoration:underline">תנאי שימוש</span> · <span style="text-decoration:underline">מדיניות פרטיות</span></div></div></div>'''
def ob_a(mode):
    return signin(mode)
def ob_b(mode):
    return ob_frame(1, f'''<div class="head" style="margin-top:24px"><div class="t1">פרטי החברה</div><div class="lbl">3 פרטים ומתחילים. אפשר לשנות אחר כך.</div></div>
<div class="pad" style="margin-top:36px;display:flex;flex-direction:column;gap:20px">
<div class="fld"><label>שם החברה</label><div class="inp">א.ב. בנייה ושיפוצים בע״מ</div></div>
<div class="fld"><label>ח.פ. / מספר עוסק</label><div class="inp"><span class="n">51-234567-8</span></div></div>
<div class="fld"><label>סוג העסק</label><div class="seg"><span class="on">חברה בע״מ</span><span>עוסק מורשה</span></div></div></div>''', "המשך")
def ob_c(mode):
    steps = [("באפליקציית פועלים: עו״ש ‹ תנועות, בוחרים טווח תאריכים"),("ייצוא לאקסל ושמירה ב״קבצים״"),("חוזרים לכאן ובוחרים את הקובץ")]
    st = "".join(f'<div style="display:flex;gap:14px;align-items:flex-start;padding:10px 0"><span class="n" style="width:28px;height:28px;border-radius:9999px;background:var(--tint);color:var(--accent-text);display:grid;place-items:center;font-size:13px;font-weight:600;flex:none">{i+1}</span><span style="padding-top:2px">{t}</span></div>' for i, t in enumerate(steps))
    return ob_frame(2, f'''<div class="head" style="margin-top:24px"><div class="t1">העלאת דוח פועלים</div><div class="lbl">מהדוח נבנה את הרווח וההפסד שלך.</div></div>
<div class="pad" style="margin-top:24px">{st}</div>
<div class="card" style="margin-top:20px;padding:12px 14px">{ic("clock",20,1.9)}<div class="tx" style="font-size:15px">מומלץ: 3 החודשים האחרונים</div></div>''', f'{ic("doc",20,2)}בחירת קובץ', '<div class="btn gho" style="height:40px">דלג לעכשיו</div>')
def ob_d(mode):
    ps = [("וילה רעננה","משפ׳ כהן",6,540000),("בניין מגורים חולון","א.ב. נכסים",4,900000),('שיפוץ דירה ת"א',"משפ׳ לוי",3,120000),("בית פרטי כפר סבא","י. מזרחי",2,240000)]
    rows = "".join(f'<div class="rowi" style="padding:13px 0"><span class="chk">{ic("check",16,2.6)}</span><div class="tx"><div>{a}</div><div class="hint">{c} · {n(k)} תקבולים · {num(v)}</div></div><span style="color:var(--text-muted)">{ic("edit",18,1.9)}</span></div>' for a, c, k, v in ps)
    return ob_frame(3, f'''<div class="head" style="margin-top:24px"><div class="t1">הפרויקטים שלך</div><div class="lbl">מצאנו אותם לפי לקוחות חוזרים בדוח.</div></div>
<div class="pad list" style="margin-top:16px">{rows}</div><div class="pad"><span class="lnk" style="margin-top:6px">{ic("plus",16,2.2)} הוספת פרויקט</span></div>''', "אישור והמשך")
def ob_e(mode):
    return ob_frame(4, f'''<div class="head" style="margin-top:24px;display:flex;gap:14px;align-items:center">{appic(56,14)}<div><div class="t1">התקנת Flow</div><div class="lbl">הוסיפו למסך הבית – נפתח כמו אפליקציה.</div></div></div>
<div class="pad list" style="margin-top:16px">
<div class="rowi">{ic("share",22,1.9,"acc")}<div class="tx">{n(1)}. ״שיתוף״ בספארי</div></div>
<div class="rowi">{ic("addsq",22,1.9,"acc")}<div class="tx">{n(2)}. ״הוסף למסך הבית״</div></div></div>
<div class="sec"><h2>רק שתי התראות</h2>
<div class="rowi">{ic("bell",22,1.9)}<div class="tx"><div>סיכום שבועי</div><div class="hint">ראשון {n("08:00")} · רווח ומה חרג</div></div></div>
<div class="rowi" style="border-top:1px solid var(--line)">{ic("clock",22,1.9)}<div class="tx"><div>תזכורת לאישור</div><div class="hint">{n("18:00")} · רק אם יש פריטים ממתינים</div></div></div></div>''', "לדוח הרווח שלי", f'<div class="btn sec">{ic("bell",20,2)}הפעלת התראות</div>')
OB = [("a", ob_a), ("b", ob_b), ("c", ob_c), ("d", ob_d), ("e", ob_e)]

@screen("10-transaction-detail")
def detail(mode):
    return f'''<div class="scr">{STATUS}{topbar("הוצאה", right=f'<span class="iconbtn">{ic("more",24,2)}</span>')}
<div class="pad" style="margin-top:12px"><div class="t3">חומרי בניין השרון בע״מ</div><div class="big" style="font-size:36px;line-height:1.2;margin-top:4px">{num(8500)}</div><div class="hint">לפני מע״מ · {n("21/09/2026")}</div>
<div style="display:flex;gap:8px;margin-top:16px"><span class="stat">{ic("check",14,2.4)}מאושר</span><span class="stat">{ic("check",14,2.4)}שולם</span></div></div>
<div class="pad list" style="margin-top:24px">
<div class="rowi">{ic("folder",22,1.9)}<div class="tx"><div class="hint">פרויקט</div><div>בניין מגורים חולון</div></div><span class="cv">{ic("chev",20,2)}</span></div>
<div class="rowi">{ic("tag",22,1.9)}<div class="tx"><div class="hint">קטגוריה</div><div>חומרים</div></div><span class="cv">{ic("chev",20,2)}</span></div>
<div class="rowi">{ic("doc",22,1.9)}<div class="tx"><div>חשבונית ותשלום</div><div class="hint">מע״מ, מספר חשבונית, שורת הבנק</div></div><span class="cv">{ic("down",20,2)}</span></div></div>
<div class="pad hint" style="display:flex;gap:6px;align-items:center;margin-top:8px"><span class="acc" style="display:grid">{ic("spark",15,2)}</span>שויך אוטומטית לפי ספק קבוע</div>
<div class="acts" style="position:absolute;bottom:34px;inset-inline:0"><div class="btn sec">{ic("split",20,2)}פיצול בין פרויקטים</div><div style="display:flex"><div class="btn gho" style="height:44px">העברה לפרויקט אחר</div><div class="btn dng" style="height:44px">{ic("trash",18,2)}מחיקה</div></div></div></div>'''

@screen("11-split")
def split(mode):
    ls = [("בניין מגורים חולון",200000,40,14400),('מגדל משרדים פ"ת',150000,30,10800),("וילה רעננה",100000,20,7200),("בית פרטי כפר סבא",50000,10,3600)]
    rows = "".join(f'<div class="pr" style="padding:12px 0"><div><div class="nm" style="font-size:16px">{a}</div><div class="hint">הכנסות החודש {num(i)}</div></div><div style="text-align:end"><div class="amt" style="font-size:16px">{num(v)}</div><div class="hint">{n(str(p)+"%")}</div></div></div>' for a, i, p, v in ls)
    return f'''<div class="scr">{STATUS}{topbar(close=True, back=False)}
<div class="head" style="padding-top:0"><div class="t1">פיצול בין פרויקטים</div><div class="lbl">משכורת עובדי שטח · ספטמבר · עבודה</div><div class="t2 n" style="margin-top:4px">{num(36000)}</div></div>
<div class="pad" style="margin-top:18px"><div class="seg"><span>שווה בשווה</span><span class="on">לפי הכנסות</span><span>ידני</span></div></div>
<div class="pad" style="margin-top:14px"><span class="chip sug">{ic("check",15,2.4)}<span>כל הפרויקטים הפעילים · {n(4)}</span></span></div>
<div class="pad rows" style="margin-top:6px">{rows}</div>
<div class="pad"><div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px"><span class="lbl">נותר לשייך</span><span class="good" style="display:flex;align-items:center;gap:4px">{ic("check",16,2.4)}<span>{num(0)} · {n("100%")}</span></span></div></div>
<div class="pad" style="margin-top:18px;display:flex;align-items:center;gap:12px"><div style="flex:1"><div>לפצל כך כל חודש</div><div class="hint">האחוזים יחושבו מחדש לפי הכנסות כל חודש</div></div><span class="sw on"><i></i></span></div>
<div class="acts" style="position:absolute;bottom:34px;inset-inline:0"><div class="btn pri">שמירת פיצול</div></div></div>'''

@screen("12-unpaid")
def unpaid(mode):
    ls = [("מ.ש. הובלות",6000,"02/09",'שיפוץ דירה ת"א',24),("אבי חשמל",8000,"10/09","וילה רעננה",16),("חומרי בניין השרון",9400,"14/09","בניין מגורים חולון",12)]
    rows = "".join(f'<div style="padding:16px 0;{"border-top:1px solid var(--line);" if k else ""}"><div style="display:flex;justify-content:space-between"><span class="t3" style="font-weight:500">{a}</span><span class="amt t3">{num(v)}</span></div><div class="hint">{n(d)} · {p} · לפני {n(g)} ימים</div><span class="btn sm sec" style="margin-top:10px">{ic("check",16,2.4)}סימון כשולם</span></div>' for k, (a, v, d, p, g) in enumerate(ls))
    return f'''<div class="scr">{STATUS}{topbar()}
<div class="head" style="padding-top:0"><div class="t1">חשבוניות פתוחות</div></div>
<div class="pad" style="margin-top:16px"><div class="big" style="font-size:36px;margin:0">{num(23400)}</div><div class="lbl">ממתין לתשלום · לא נכלל ברווח</div></div>
<div class="pad" style="margin-top:20px">{rows}</div>
{tabbar("home")}</div>'''

@screen("13-notifications")
def notif(mode):
    wall, card = "var(--tint)", "var(--surface)"
    def nt(t, b, when):
        return f'''<div style="background:{card};border-radius:20px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start">
{appic(38,9)}
<div style="flex:1"><div style="display:flex;justify-content:space-between"><span style="font-weight:600">Flow</span><span class="hint" style="color:var(--text-secondary)">{when}</span></div><div style="font-weight:600;margin-top:1px">{t}</div><div style="font-size:15px;color:var(--text-secondary);font-weight:400">{b}</div></div></div>'''
    return f'''<div class="scr" style="background:{wall}">{STATUS}
<div style="text-align:center;margin-top:30px"><div class="lbl" style="color:var(--text-secondary)">יום שלישי, 29 בספטמבר</div><div class="n" style="font-size:88px;font-weight:600;line-height:1.05;letter-spacing:-.02em">18:00</div></div>
<div style="padding:0 12px;margin-top:280px;display:flex;flex-direction:column;gap:10px">
{nt(f"{n(7)} תנועות מחכות לך", "בערך 2 דקות", "עכשיו")}
{nt("סיכום שבועי", f"רווח {num(42000)}. וילה רעננה חרגה ב-{n('15%')} מהתקציב", "יום א׳ 08:00")}</div>
<div style="position:absolute;bottom:34px;inset-inline:0;text-align:center">{EXTAG}</div><span class="hi"></span></div>'''

@screen("14-settings")
def settings(mode):
    def r(icon, t, h="", right=None):
        right = right if right is not None else f'<span class="cv">{ic("chev",20,2)}</span>'
        return f'<div class="rowi">{ic(icon,22,1.9)}<div class="tx"><div>{t}</div>{f"<div class=hint>{h}</div>" if h else ""}</div>{right}</div>'
    on, off = '<span class="sw on"><i></i></span>', '<span class="sw"><i></i></span>'
    return f'''<div class="scr tall">{STATUS}{topbar(back=False)}
<div class="head" style="padding-top:0"><div class="t1">הגדרות</div></div>
<div class="grp">החברה</div><div class="pad list">{r("folder","א.ב. בנייה ושיפוצים בע״מ",f"ח.פ. {n('51-234567-8')} · חברה בע״מ")}<div class="rowi">{GLOGO.replace('class="g"','class="g" width="22" height="22" style="flex:none"')}<div class="tx"><div>חשבון Google</div><div class="hint"><bdi>owner@example.com</bdi></div></div><span class="cv">{ic("chev",20,2)}</span></div></div>
<div class="grp">חיבור בנק</div><div class="pad list">{r("bank","בנק הפועלים",f"חשבון {n('12-345-678901')} · דוח אחרון {n('25/09/2026')}", "")}{r("upload","העלאת דוח חדש","קובץ Excel מאפליקציית פועלים")}</div>
<div class="grp">סיווג</div><div class="pad list">{r("tag","קטגוריות",f"{n(7)} הוצאות · {n(2)} הכנסות")}{r("folder","פרויקטים",f"{n(17)} פעילים · {n(21)} הסתיימו")}{r("repeat","כללי פיצול חוזרים",f"{n(2)} כללים פעילים")}</div>
<div class="grp">התראות</div><div class="pad list">{r("bell","סיכום שבועי",f"ראשון {n('08:00')}",on)}{r("clock","תזכורת לפריטים ממתינים",f"כל יום {n('18:00')} · רק אם יש",on)}</div>
<div class="grp">אישור ותצוגה</div><div class="pad list">{r("checkc","אישור אוטומטי בביטחון גבוה","פריטים ודאיים לא מגיעים לתור",on)}{r("split","רווח אחרי חלק בכלליות","ברירת מחדל בבית ובפרויקט",off)}</div>
<div class="grp">נתונים</div><div class="pad list">{r("download","ייצוא לרואה החשבון","Excel / CSV")}<div class="rowi bad">{ic("logout",22,1.9)}<div class="tx">התנתקות</div></div></div>
<div class="hint" style="text-align:center;margin-top:20px"><span dir="ltr" style="unicode-bidi:isolate">Flow · POC 0.1</span></div>
{tabbar("set")}</div>'''

# ---------------- design system sheet ----------------
def ds(mode):
    C = COLOR[mode]
    roles = [("bg","page"),("surface","cards, tab bar"),("tint","tinted fill"),("line","hairline"),("text","main text, figures"),("text-secondary","labels"),("text-muted","hints"),
             ("accent","+ button, primary"),("accent-text","links, active tab"),("on-accent","text on accent"),("band","top band"),("on-band","band text"),("on-band-secondary","band labels"),("good","good ▲"),("bad","bad ▼"),("warning","warning")]
    pair = {"text":"bg","text-secondary":"bg","text-muted":"bg","accent-text":"bg","on-accent":"accent","on-band":"band","on-band-secondary":"band","good":"band-chip","bad":"band-chip","warning":"surface"}
    sw = "".join(f'<div class="sw2"><i style="background:{C[k]}"></i><b>{k}</b><span class="n">{C[k]}</span><em>{d}{(" · " + format(contrast(C[k], C[pair[k]]), ".1f") + ":1") if k in pair else ""}</em></div>' for k, d in roles)
    ty = "".join(f'<div class="ty"><span class="k">{k} · {s}/{lh} · {w}</span><span style="font-size:{s}px;line-height:{lh};font-weight:{w}">{"Flow" if k=="wordmark" else ("₪200,000" if k in ("hero","display") else "פרויקטים מובילים")}</span></div>' for k, (s, lh, w) in TYPE.items())
    sp = "".join(f'<div class="spx"><i style="width:{v}px"></i><span class="n">{v}</span></div>' for k, v in SPACE.items() if k.isdigit())
    rd = "".join(f'<div class="rdx"><i style="border-radius:{min(v,28)}px"></i><span>{k} {"full" if v > 100 else v}</span></div>' for k, v in RADIUS.items())
    comp = f'''
<div class="cc"><h4>Buttons</h4><div class="btn pri">אישור</div><div class="btn sec" style="margin-top:8px">שינוי</div><div class="btn gho" style="margin-top:4px">דלג</div><div style="display:flex;gap:8px;margin-top:8px"><span class="btn sm sec">{ic("plus",16,2.4)}פרויקט חדש</span><span class="btn sm dis" style="background:var(--line)">מושבת</span></div></div>
<div class="cc"><h4>FAB + tab bar</h4><div style="position:relative;height:96px;border-radius:16px;overflow:hidden;border:1px solid var(--line)">{tabbar("home")}</div><div style="display:flex;gap:12px;margin-top:12px;align-items:center"><span class="fab">{ic("plus",24,2.4)}</span><span class="hint">48px · accent · the only filled accent shape</span></div></div>
<div class="cc"><h4>Band · period pill · delta pill</h4><div class="band" style="border-radius:20px;padding:16px"><div style="display:flex;justify-content:space-between;align-items:center"><span class="wm">Flow</span><span class="per">החודש {ic("down",16,2.25)}</span></div><div class="big" style="font-size:36px">{num(200000)}</div><div class="dl"><span class="delta dn">▼ {n("10%")}</span><span class="delta up">▲ {n("8%")}</span><span class="lbl">מחודש שעבר</span></div></div><div style="margin-top:10px;display:flex;gap:8px;align-items:center"><span class="per">החודש {ic("down",16,2.25)}</span><span class="delta dn flat">▼ {n("10%")}</span><span class="hint">on white</span></div></div>
<div class="cc"><h4>Pending card</h4><div class="card" style="margin:0">{ic("inbox",22,1.9)}<div class="tx"><div style="font-size:17px">{n(7)} פריטים ממתינים לאישור</div><div class="hint">{n(3)} חשבוניות פתוחות · {num(23400)}</div></div><span class="cv">{ic("chev",20,2)}</span></div></div>
<div class="cc"><h4>Project row · transaction row</h4><div class="rows"><div class="pr"><div><div class="nm">וילה רעננה</div><div class="hint">רווחיות {n("28%")}</div></div><div class="amt">{num(50000)}</div></div><div class="pr"><div><div class="nm">שיפוץ דירה ת"א</div><div class="hint">רווחיות {n("−17%")}</div></div><div class="amt bad">{num(-10000)}</div></div>
<div class="rowi" style="border-top:1px solid var(--line)">{ic("doc",22,1.9)}<div class="tx"><div>טמבור בע"מ</div><div class="hint">חומרים · {n("22/09")}</div></div><span class="amt n" style="font-weight:600">{num(-12000)}</span></div></div></div>
<div class="cc"><h4>Chips</h4><div class="chips"><span class="chip on">{ic("spark",15,2)}בניין מגורים חולון</span><span class="chip sug">וילה רעננה <span class="hint">אחרון</span></span></div><div class="chips" style="margin-top:8px"><span class="chip on">{ic("check",15,2.4)}חומרים</span><span class="chip">ציוד והשכרה</span><span class="chip">הובלה</span></div><div class="chips" style="margin-top:8px"><span class="stat">{ic("check",14,2.4)}מאושר · אוטומטי</span><span class="stat">{ic("check",14,2.4)}שולם</span></div></div>
<div class="cc"><h4>Segmented tabs</h4><div class="seg"><span class="on">הוצאות</span><span>הכנסות</span></div><div class="seg" style="margin-top:10px"><span>שווה בשווה</span><span class="on">לפי הכנסות</span><span>ידני</span></div></div>
<div class="cc"><h4>Inputs · search</h4><div class="fld"><label>שם הפרויקט</label><div class="inp focus">גן יבנה – תוספת קומה</div></div><div class="fld" style="margin-top:10px"><label>תקציב (אופציונלי)</label><div class="inp"><span class="ph">₪</span></div></div><div class="inp search" style="margin-top:10px">{ic("search",20,2)}<span class="ph">חיפוש פרויקט או קוד</span></div></div>
<div class="cc"><h4>Switch · checkbox</h4><div class="rowi"><div class="tx"><div>לזכור לספק הזה</div><div class="hint">פעיל</div></div><span class="sw on"><i></i></span></div><div class="rowi" style="border-top:1px solid var(--line)"><div class="tx"><div>אחרי חלק בכלליות</div><div class="hint">כבוי כברירת מחדל</div></div><span class="sw"><i></i></span></div><div style="display:flex;gap:10px;margin-top:6px"><span class="chk">{ic("check",16,2.6)}</span><span class="chk off"></span></div></div>
<div class="cc"><h4>Bottom sheet</h4><div style="position:relative;height:236px;border-radius:16px;overflow:hidden;background:var(--bg);border:1px solid var(--line)"><div class="scrim"></div><div class="sheet" style="padding-bottom:16px"><div class="grab"></div><div class="shd"><div><div class="t2">סימון כשולם</div><div class="lbl">חומרי בניין השרון · {num(9400)}</div></div></div><div class="pad" style="margin-top:12px"><div class="seg"><span class="on">מזומן</span><span>צ׳ק</span><span>אחר</span></div></div><div class="acts" style="margin-top:12px"><div class="btn pri">שמירה</div></div></div></div></div>
<div class="cc"><h4>Empty state</h4><div class="empty">{ic("checkc",40,1.6)}<div class="t3">הכל מאושר</div><div class="hint">אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש.</div><span class="btn sm sec" style="margin-top:6px">לדף הבית</span></div></div>
<div class="cc"><h4>Toast</h4><div class="toast">{ic("check",18,2.4)}<span>אושר · וילה רעננה</span><span class="u">ביטול</span></div><div class="hint" style="margin-top:10px">4 s, above the tab bar, one at a time</div></div>
'''
    return f'''<div style="padding:32px 40px"><div style="display:flex;justify-content:space-between;align-items:baseline"><div><span class="wm logo" style="font-size:32px">Flow</span> <span class="t2" style="margin-right:12px">Design system · {"light" if mode=="light" else "dark"}</span></div><span class="hint">V1 Violet with coloured band · Rubik 400/500/600/700 · all text ≥ 4.5:1 · {EXTAG}</span></div>
<h3 class="dsh">Colour</h3><div class="swg">{sw}</div>
<div style="display:grid;grid-template-columns:1.3fr 1fr;gap:40px"><div><h3 class="dsh">Type · Rubik</h3>{ty}</div><div><h3 class="dsh">Spacing</h3>{sp}<div class="hint" style="margin-top:6px">sides 24 · card inset 16 · sections 32–40</div><h3 class="dsh">Radius</h3><div style="display:flex;gap:14px;flex-wrap:wrap">{rd}</div></div></div>
<h3 class="dsh">Components</h3><div class="ccg">{comp}</div></div>'''
DS_CSS = '''
.dsh{font-size:13px;letter-spacing:.06em;color:var(--text-muted);font-weight:600;margin:32px 0 14px;direction:ltr;text-align:right}
.swg{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}
.sw2{font-size:12px} .sw2 i{display:block;height:56px;border-radius:12px;border:1px solid var(--line);margin-bottom:6px} .sw2 b{display:block;font-weight:600;direction:ltr;text-align:right} .sw2 span{display:block;color:var(--text-secondary);font-weight:400} .sw2 em{display:block;font-style:normal;color:var(--text-muted);font-weight:400}
.ty{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line);padding:8px 0} .ty .k{font-size:12px;color:var(--text-muted);direction:ltr;font-weight:400}
.spx{display:flex;align-items:center;gap:10px;margin:5px 0} .spx i{display:block;height:12px;background:var(--accent);border-radius:3px} .spx span{font-size:12px;color:var(--text-secondary)}
.rdx{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;color:var(--text-secondary);direction:ltr} .rdx i{display:block;width:56px;height:56px;background:var(--tint);border:1.5px solid var(--accent)}
.ccg{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
.cc{border:1px solid var(--line);border-radius:20px;padding:18px;background:var(--surface)} .cc h4{font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:12px;direction:ltr;text-align:right;letter-spacing:.04em}
.cc .tb{position:absolute}
'''

# ---------------- build ----------------
def build():
    for mode in ("light", "dark"):
        for fid, fn in S.items():
            (OUT / f"{fid}-{mode}.html").write_text(doc(f"Flow · {fid} · {mode}", fn(mode), mode), encoding="utf-8")
        for k, fn in OB:
            (OUT / f"09{k}-onboarding-{mode}.html").write_text(doc(f"Flow · 09{k} · {mode}", fn(mode), mode), encoding="utf-8")
        strip = "".join(f'<div class="ph"><iframe src="09{k}-onboarding-{mode}.html" width="390" height="844" scrolling="no"></iframe><div class="cap">{lab}</div></div>' for (k, _), lab in zip(OB, ["כניסה", "פרטי החברה", "דוח פועלים", "הפרויקטים שלך", "התקנה"]))
        (OUT / f"09-onboarding-{mode}.html").write_text(doc("Flow · 09 onboarding", f'<div class="strip">{strip}</div>', mode,
            ".strip{display:flex;gap:24px;padding:24px;direction:rtl}.ph iframe{border:0;border-radius:24px;display:block;box-shadow:0 0 0 1px var(--line)}.cap{text-align:center;margin-top:10px;font-size:15px;color:var(--text-secondary)}body{background:var(--tint)}", w=2094), encoding="utf-8")
        # overview grid
        order = ["01-home","02-project","03-review","04-add","05-projects","06-change-sheet","07-categories","08-upload-results","09a-onboarding","10-transaction-detail","11-split","12-unpaid","13-notifications","14-settings"]
        names = ["01 בית","02 פרויקט","03 לאישור","04 הוספה","05 פרויקטים","06 שינוי שיוך","07 קטגוריות","08 תוצאות העלאה","09 הרשמה","10 פרטי הוצאה","11 פיצול","12 חשבוניות פתוחות","13 התראות","14 הגדרות"]
        cells = "".join(f'<div class="c"><div class="f"><iframe src="{o}-{mode}.html" width="390" height="844" scrolling="no"></iframe></div><div class="cap">{nm}</div></div>' for o, nm in zip(order, names))
        (OUT / f"overview-{mode}.html").write_text(doc("Flow overview", f'<div class="hdr"><span class="wm logo" style="font-size:30px">Flow</span><span class="t2">כל המסכים · {"מצב בהיר" if mode=="light" else "מצב כהה"}</span>{EXTAG}</div><div class="g">{cells}</div>', mode,
            "body{background:var(--tint);padding:28px 36px}.hdr{display:flex;gap:16px;align-items:baseline;margin-bottom:20px}.g{display:grid;grid-template-columns:repeat(7,1fr);gap:22px}.f{width:254px;height:549px;border-radius:30px;overflow:hidden;border:5px solid #1D1728;background:var(--bg)}.f iframe{border:0;transform:scale(.6256);transform-origin:top right;display:block;margin-right:0}.cap{text-align:center;margin-top:8px;font-size:15px}", w=1990), encoding="utf-8")
    tok = {"font": FONT, "color": COLOR, "type": {k: {"size": s, "lineHeight": lh, "weight": w, **({"tracking": TRACKING[k]} if k in TRACKING else {})} for k, (s, lh, w) in TYPE.items()}, "space": SPACE, "radius": RADIUS,
           "contrast": {m: {f"{a} on {b}": round(contrast(COLOR[m][a], COLOR[m][b]), 2) for a, b in CHECKS} for m in COLOR}}
    (OUT / "design-tokens.json").write_text(json.dumps(tok, ensure_ascii=False, indent=2), encoding="utf-8")
if __name__ == "__main__":
    build()
