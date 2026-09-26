import sys; sys.path.insert(0,'/workspace/flow-logo/final')
exec(open('/workspace/flow-logo/final/build_final.py').read().split('# ---------- icon ----------')[0])
from build_final import icon_svg, THEMES, raster, uri   # noqa (re-runs export, harmless)
import re
CAP=700/WH  # cap height as a fraction of wordmark box height (box = l-ascender 710 + o-overshoot 10)
def tile(bg,inner,label,fg="#6b6478",h=200,extra=""):
    return f'<div class=t style="background:{bg};height:{h}px;{extra}"><div class=in>{inner}</div><span style="color:{fg}">{label}</span></div>'
ico=lambda t,px,r=0.2237: icon_svg(*THEMES[t],radius=r,px=px)
real=lambda t,p: f'<img src="{uri(raster(icon_svg(*THEMES[t],radius=0.2237,snap_px=p if p<=48 else None),p))}" width={p} height={p}>'
X=lambda s: f'<div class=x>✕ {s}</div>'
# clear-space diagram: wordmark 120px tall; clear space = half the cap height on every side
H=120; cs=H*CAP/2
clear=f'''<div style="position:relative;display:inline-block;padding:{cs}px;background:repeating-linear-gradient(45deg,#F3ECFE 0 6px,#fff 6px 12px);outline:1px dashed #B894FF">
  <div style="background:#fff">{wm_svg(V,H)}</div>
  <div class=dim style="left:0;top:0;width:{cs}px;height:{cs}px">½F</div></div>'''
iclear=f'''<div style="position:relative;width:180px;height:180px">{ico("brand",180)}
  <div style="position:absolute;left:{180*0.3329}px;top:{180*0.25}px;width:{180*0.3643}px;height:{180*0.5}px;outline:1px dashed #fff"></div></div>'''
donts="".join([
  tile("#fff",wm_svg("#15733F",56),X("recolour (only violet, lilac, white, ink)"),h=150),
  tile("#fff",f'<div style="transform:scaleX(1.3)">{wm_svg(V,44)}</div>',X("stretch or squash"),h=150),
  tile("#fff",f'<div style="filter:drop-shadow(3px 4px 3px rgba(0,0,0,.35))">{wm_svg(V,56)}</div>',X("add shadows or effects"),h=150),
  tile("#fff",f'<div style="font:italic 700 60px Rubik;color:{V};letter-spacing:.06em">Flow</div>',X("retype, italicise or re-space"),h=150),
  tile(V,wm_svg("#9C6BF0",56),'<div class=x style="color:#fff">✕ low contrast (violet on violet)</div>',"#fff",h=150),
  tile("#fff",f'<div style="transform:rotate(-12deg)">{ico("brand",90)}</div>',X("rotate, or restyle the F"),h=150),
])
html=f'''<html><head><meta charset="utf-8"><style>
body{{margin:0;font-family:Rubik;color:{INK};background:#fff;width:1600px}} .w{{padding:44px 56px}}
h1{{font-size:34px;margin:0 0 4px}} .sub{{color:#6b6478;margin:0 0 30px;font-size:16px}}
h2{{font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:#8d84a0;margin:26px 0 12px;font-weight:600}}
.g{{display:grid;gap:16px}} .t{{border-radius:18px;border:1px solid #eee;position:relative;display:flex;align-items:center;justify-content:center}}
.t span{{position:absolute;left:16px;bottom:10px;font-size:12.5px}} .in{{display:flex;align-items:center;gap:22px}}
.x{{color:#C3302B;font-weight:600}} .dim{{position:absolute;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#7B3FE4}}
.note{{font-size:14px;color:#564E66;line-height:1.55}} .note b{{color:{INK}}}
.row{{display:flex;gap:28px;align-items:flex-end}} .c{{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;color:#8d84a0}}
</style></head><body><div class=w>
<h1>Flow · logo</h1><p class=sub>Main logo = the app wordmark “Flow” (Rubik 700, letter-spacing −0.01em) in brand violet. App icon = S1, the same Rubik 700 F.</p>
<h2>1 · Main logo</h2>
<div class=g style="grid-template-columns:repeat(4,1fr)">
 {tile("#fff",wm_svg(V,70),"Violet #7B3FE4 on white (primary)")}
 {tile(DARK,wm_svg(V2,70),"Lilac #B894FF on dark #15111E","#8d84a0")}
 {tile(V,wm_svg(W,70),"White on the violet band","#E6DAFB")}
 {tile("#fff",wm_svg(INK,70),"Ink #1D1728 (one-colour / print)")}
</div>
<h2>2 · App icon (S1)</h2>
<div class=g style="grid-template-columns:1.25fr 1fr">
 <div class=t style="height:250px;background:#F6F4F9;justify-content:flex-start;padding-left:34px"><div class=row>
   <div class=c>{ico("brand",150)}Brand · white F on violet<br><b style="color:{INK}">installed icon, in-app, favicon</b></div>
   <div class=c>{ico("light",150)}Light · violet F on white</div>
   <div class=c>{ico("dark",150)}Dark · #B894FF F on #15111E</div></div></div>
 <div class=t style="height:250px;background:#fff;flex-direction:column;gap:14px">
   <div class=row>{real("brand",180)}{real("brand",48)}{real("brand",32)}{real("brand",16)}<img src="{uri(raster(icon_svg(*THEMES["brand"],radius=0.2237,snap_px=16),16))}" width=96 style="image-rendering:pixelated"></div>
   <div style="font-size:12px;color:#8d84a0">real pixels: 180 · 48 · 32 · 16 · 16 enlarged (≤48 px files are pixel-snapped)</div></div>
</div>
<div class=g style="grid-template-columns:1.25fr 1fr;margin-top:6px">
 <div><h2>3 · Clear space</h2><div class=t style="height:300px;gap:60px">{clear}{iclear}</div>
   <p class=note>Keep at least <b>½ the cap height of the F</b> clear on every side of the wordmark. In the icon the F is fixed at <b>50% of the tile height</b>, optically centred; never enlarge it or add other elements.</p></div>
 <div><h2>4 · Minimum sizes</h2><div class=t style="height:300px;flex-direction:column;gap:26px">
   <div class=row><div class=c>{wm_svg(V,16)}wordmark 16 px tall (≈ 22 px font)</div><div class=c>{wm_svg(V,12)}absolute min 12 px</div></div>
   <div class=row><div class=c>{real("brand",32)}icon 32 px</div><div class=c>{real("brand",16)}favicon 16 px (use favicon.ico / -16.png)</div></div></div>
   <p class=note>Screen: wordmark ≥ 12 px tall (app header uses 22 px Rubik 700). Print: ≥ 6 mm tall. Icon below 48 px: use the supplied pixel-snapped PNGs, not a scaled SVG.</p></div>
</div>
<h2>5 · Don’t</h2>
<div class=g style="grid-template-columns:repeat(6,1fr)">{donts}</div>
<p class=note style="margin-top:14px">Contrast: violet #7B3FE4 on white 5.7:1 · lilac #B894FF on #15111E 7.7:1 · white on #7B3FE4 5.7:1. Files: flow-logo/final/ (wordmark/, icon/, pwa/, favicon/) · see LOGO.md.</p>
</div></body></html>'''
shot(html,f"{OUT}/board/flow-logo-usage.png",1600,1200)
print("ok")
