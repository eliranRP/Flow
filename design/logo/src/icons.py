# Straight-line F icon options on a 100x100 canvas. Shapes: ("rect",x,y,w,h,r) or ("line",[(x,y)...],width,cap)
from common import *
RS=50/700  # Rubik 700 F scaled to 50-unit cap height
def rubikF(ox,oy,s):
    # exact Rubik 700 'F' outline (quadratic corners r=25 on outer corners), y flipped, cap height 700
    X=lambda x: ox+x*s; Y=lambda y: oy+(700-y)*s
    q=lambda a,b,c,d,e,f: f"Q{X(a):.2f} {Y(b):.2f} {X(c):.2f} {Y(d):.2f}"
    # rebuilt from the glyph's on/off curve points (implied on-curve midpoints expanded)
    d=(f"M{X(95):.2f} {Y(0):.2f} "
       f"C{X(81):.2f} {Y(0):.2f} {X(70):.2f} {Y(11):.2f} {X(70):.2f} {Y(25):.2f} "
       f"L{X(70):.2f} {Y(675):.2f} C{X(70):.2f} {Y(689):.2f} {X(81):.2f} {Y(700):.2f} {X(95):.2f} {Y(700):.2f} "
       f"L{X(555):.2f} {Y(700):.2f} C{X(569):.2f} {Y(700):.2f} {X(580):.2f} {Y(689):.2f} {X(580):.2f} {Y(675):.2f} "
       f"L{X(580):.2f} {Y(574):.2f} C{X(580):.2f} {Y(560):.2f} {X(569):.2f} {Y(549):.2f} {X(555):.2f} {Y(549):.2f} "
       f"L{X(246):.2f} {Y(549):.2f} L{X(246):.2f} {Y(402):.2f} L{X(535):.2f} {Y(402):.2f} "
       f"C{X(549):.2f} {Y(402):.2f} {X(560):.2f} {Y(391):.2f} {X(560):.2f} {Y(377):.2f} "
       f"L{X(560):.2f} {Y(276):.2f} C{X(560):.2f} {Y(262):.2f} {X(549):.2f} {Y(251):.2f} {X(535):.2f} {Y(251):.2f} "
       f"L{X(246):.2f} {Y(251):.2f} L{X(246):.2f} {Y(25):.2f} C{X(246):.2f} {Y(11):.2f} {X(235):.2f} {Y(0):.2f} {X(221):.2f} {Y(0):.2f} Z")
    return d

OPTS = {
 "S1": dict(name="Rubik F", desc="The Rubik 700 capital F from the wordmark itself (same stem, bar weights and softened outer corners), centred as a solid mark."),
 "S2": dict(name="Monoline", desc="A lighter monoline F: three equal-weight straight strokes with round ends, matching Rubik's soft corners."),
 "S3": dict(name="Square, short bar", desc="Sharp-cornered geometric F with squared terminals and a noticeably shorter middle bar for a crisper, more architectural look."),
 "S4": dict(name="Three bars", desc="F assembled from three separate bars (stem, top, middle) with small even gaps, modular, like building blocks."),
 "S5": dict(name="Offset, padded", desc="A small Rubik-weight F placed low-left in the tile with generous padding, a quiet 'corner monogram'."),
}
def rubik_rects(x0,top,s):
    # Rubik 700 F as plain rectangles (for pixel-snapped small sizes; outer corner radius is sub-pixel there)
    return [("rect",x0,top,176*s,700*s,0),("rect",x0,top,510*s,151*s,0),("rect",x0,top+298*s,490*s,151*s,0)]
def shapes(key, small=False):
    if key=="S1" and small:
        s=RS; w=510*s; return rubik_rects(50-w/2+1.5,25,s)
    if key=="S2" and small:
        sw=8.5; x=34-sw/2; t=26-sw/2
        return [("rect",x,t,sw,48+sw,0),("rect",x,t,67-34+sw,sw,0),("rect",x,48-sw/2,61-34+sw,sw,0)]
    if key=="S5" and small:
        s=36/700; return rubik_rects(24,40,s)
    if key=="S1":
        s=RS; w=510*s; ox=50-w/2-70*s+1.5; oy=25
        return [("path",rubikF(ox,oy,s))]
    if key=="S2":
        sw=8.5; x=34; t=26; b=74; r=67; m=48; mr=61
        return [("line",[(r,t),(x,t),(x,b)],sw),("line",[(x,m),(mr,m)],sw)]
    if key=="S3":
        x=33; t=25; H=50; st=12.5; bt=11; top=37; mid=25; my=t+20
        if small: return [("rect",x,t,st,H,0),("rect",x,t,top,bt,0),("rect",x,my,mid,bt,0)]
        P=[(x,t),(x+top,t),(x+top,t+bt),(x+st,t+bt),(x+st,my),(x+mid,my),(x+mid,my+bt),(x+st,my+bt),(x+st,t+H),(x,t+H)]
        return [("path","M"+" L".join(f"{a} {b}" for a,b in P)+"Z")]
    if key=="S4":
        x=33; t=25; H=50; st=12; g=3.6; bt=11; top=24; mid=17; my=t+20
        return [("rect",x,t,st,H,0),("rect",x+st+g,t,top,bt,0),("rect",x+st+g,my,mid,bt,0)]
    if key=="S5":
        s=36/700; ox=24-70*s; oy=40
        return [("path",rubikF(ox,oy,s))]

def snap(v,px):  # snap a 100-unit coordinate to the pixel grid of a px-sized icon
    return round(v*px/100)*100/px

def icon_svg(key, fg, bg, px=None, radius=0.2237, snap_px=None, border=None):
    body=""
    for sh in shapes(key, small=bool(snap_px)):
        if sh[0]=="rect":
            _,x,y,w,h,r=sh
            if snap_px:
                x1,y1=snap(x+w,snap_px),snap(y+h,snap_px); x,y=snap(x,snap_px),snap(y,snap_px)
                w=max(x1-x,100/snap_px); h=max(y1-y,100/snap_px)
            body+=f'<rect x="{x:.3f}" y="{y:.3f}" width="{w:.3f}" height="{h:.3f}" rx="{r}"/>'
        elif sh[0]=="path":
            body+=f'<path d="{sh[1]}"/>'
        else:
            _,pts,sw=sh
            body+=f'<polyline points="{" ".join(f"{a},{b}" for a,b in pts)}" fill="none" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
    bgel=f'<rect width="100" height="100" rx="{100*radius}" fill="{bg}"/>' if bg else ''
    if border: bgel+=f'<rect x=".5" y=".5" width="99" height="99" rx="{100*radius-.5}" fill="none" stroke="{border}" stroke-width="1"/>'
    sz=f' width="{px}" height="{px}"' if px else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"{sz}>{bgel}<g fill="{fg}">{body}</g></svg>'

# light / dark / brand treatments
THEMES = {
 "light": dict(fg=V,  bg=W,    border="#E6E1EE"),   # violet F on white tile (border only in previews)
 "dark":  dict(fg=V2, bg=DARK, border=None),        # #B894FF F on #15111E
 "brand": dict(fg=W,  bg=V,    border=None),        # white F on violet = current in-app .appic style
}
def themed(key, theme, px=None, snap_px=None, preview=True):
    t=THEMES[theme]
    return icon_svg(key,t["fg"],t["bg"],px=px,snap_px=snap_px,border=t["border"] if preview else None)
