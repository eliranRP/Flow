# Flow final logo package: wordmark (Rubik 700 outlines) + S1 app icon (Rubik 700 'F'), all colours per brand.
import sys, io, json, hashlib
sys.path.insert(0,'/workspace/flow-logo/round3'); sys.path.insert(0,'/workspace/flow-logo')
from common import WM, wordmark_svg, raster, uri, shot
from icons import rubikF, RS
import cairosvg
from PIL import Image
OUT='/workspace/flow-logo/final'
V='#7B3FE4'; V2='#B894FF'; INK='#1D1728'; DARK='#15111E'; W='#FFFFFF'; TINT='#F3ECFE'

# ---------- wordmark ----------
x0,y0,x1,y1=WM['bounds']; WW=x1-x0; WH=y1-y0; AR=WW/WH
def wm_svg(color, h=None):
    sz=f' width="{h*AR:.2f}" height="{h}"' if h else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WW:g} {WH:g}"{sz} role="img" aria-label="Flow">'
            f'<title>Flow</title><path fill="{color}" transform="translate({-x0:g} {-y0:g})" d="{WM["d"]}"/></svg>')
WMC={"violet":V,"lilac":V2,"white":W,"ink":INK}
for n,c in WMC.items():
    open(f"{OUT}/wordmark/flow-wordmark-{n}.svg","w").write(wm_svg(c))
    for sc in (2,4):   # 1x = 32 px tall (cap/ascender height of the outline box)
        h=32*sc; png=cairosvg.svg2png(bytestring=wm_svg(c).encode(),output_height=h,output_width=round(h*AR))
        open(f"{OUT}/wordmark/flow-wordmark-{n}@{sc}x.png","wb").write(png)

# ---------- icon ----------
S=RS; FW=510*S; OX=50-FW/2-70*S+1.5; OY=25          # F: 50% of tile height, optically centred (+1.5 right)
F_PATH=rubikF(OX,OY,S)
def f_rects(): return [(OX+70*S,OY,176*S,700*S),(OX+70*S,OY,510*S,151*S),(OX+70*S,OY+298*S,490*S,151*S)]
def snap(v,px): return round(v*px/100)*100/px
def icon_svg(fg,bg,radius=0.0,px=None,snap_px=None,scale=1.0):
    """radius=0 -> full-bleed square (OS applies its mask). scale<1 shrinks the F about the centre (maskable)."""
    if snap_px:
        body=""
        for x,y,w,h in f_rects():
            X0,Y0,X1,Y1=[snap(v,snap_px) for v in (x,y,x+w,y+h)]
            body+=f'<rect x="{X0:.3f}" y="{Y0:.3f}" width="{X1-X0:.3f}" height="{Y1-Y0:.3f}"/>'
    else: body=f'<path d="{F_PATH}"/>'
    g=f'<g fill="{fg}" transform="translate({50*(1-scale):g} {50*(1-scale):g}) scale({scale:g})">{body}</g>'
    bgel=f'<rect width="100" height="100" rx="{100*radius:g}" fill="{bg}"/>' if bg else ''
    sz=f' width="{px}" height="{px}"' if px else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"{sz}>{bgel}{g}</svg>'
THEMES={"light":(V,W),"dark":(V2,DARK),"brand":(W,V)}
SIZES=[1024,512,192,180,167,152,120,48,32,16]
for t,(fg,bg) in THEMES.items():
    open(f"{OUT}/icon/flow-icon-{t}.svg","w").write(icon_svg(fg,bg))                      # full-bleed master
    open(f"{OUT}/icon/flow-icon-{t}-rounded.svg","w").write(icon_svg(fg,bg,radius=0.2237)) # preview / docs
    for p in SIZES:
        open(f"{OUT}/icon/flow-icon-{t}-{p}.png","wb").write(raster(icon_svg(fg,bg,snap_px=p if p<=48 else None),p))
open(f"{OUT}/icon/flow-glyph-F.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{OX+70*S:.3f} {OY} {FW:.3f} 50"><path fill="{V}" d="{F_PATH}"/></svg>')

# ---------- PWA ----------
fg,bg=THEMES["brand"]
for p in (512,192):
    open(f"{OUT}/pwa/maskable-{p}.png","wb").write(raster(icon_svg(fg,bg),p))       # F already inside the 80% safe circle
    open(f"{OUT}/pwa/icon-{p}.png","wb").write(raster(icon_svg(fg,bg),p))
    open(f"{OUT}/pwa/monochrome-{p}.png","wb").write(raster(icon_svg(W,None),p))   # Android themed icon (alpha only)
open(f"{OUT}/pwa/apple-touch-icon.png","wb").write(raster(icon_svg(fg,bg),180))
open(f"{OUT}/pwa/maskable.svg","w").write(icon_svg(fg,bg))
manifest={"name":"Flow","short_name":"Flow","lang":"he","dir":"rtl","start_url":"/","display":"standalone",
 "background_color":"#FFFFFF","theme_color":"#7B3FE4",
 "icons":[{"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},
          {"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},
          {"src":"/icons/maskable-192.png","sizes":"192x192","type":"image/png","purpose":"maskable"},
          {"src":"/icons/maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"},
          {"src":"/icons/monochrome-512.png","sizes":"512x512","type":"image/png","purpose":"monochrome"}]}
open(f"{OUT}/pwa/manifest.webmanifest","w").write(json.dumps(manifest,indent=2,ensure_ascii=False))
open(f"{OUT}/pwa/head-snippet.html","w").write('''<!-- Flow icons: put /pwa/* files under /icons/ and favicon files at the site root -->
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#7B3FE4">
''')

# ---------- favicon (white F on violet, rounded) ----------
FR=0.22
open(f"{OUT}/favicon/favicon.svg","w").write(icon_svg(W,V,radius=FR))
ims=[Image.open(io.BytesIO(raster(icon_svg(W,V,radius=FR,snap_px=p),p))).convert("RGBA") for p in (48,32,16)]
for im,p in zip(ims,(48,32,16)): im.save(f"{OUT}/favicon/favicon-{p}.png")
ims[0].save(f"{OUT}/favicon/favicon.ico",format="ICO",sizes=[(48,48),(32,32),(16,16)],append_images=ims[1:])
print("icon F bbox in 100-grid:", round(OX+70*S,2), OY, round(FW,2), 50)
