# Converts the app wordmark (Rubik 700, letter-spacing -0.01em, "Flow") to SVG paths using HarfBuzz shaping (same kerning as Chrome).
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import io, json
SRC="/usr/share/fonts/truetype/sand-box/google/Rubik/Rubik-VariableFont_wght.ttf"
f=TTFont(SRC); inst=instantiateVariableFont(f,{"wght":700},inplace=False)
buf=io.BytesIO(); inst.save(buf); data=buf.getvalue(); open("work/Rubik-700-static.ttf","wb").write(data)
face=hb.Face(data); font=hb.Font(face); upem=face.upem
b=hb.Buffer(); b.add_str("Flow"); b.guess_segment_properties()
hb.shape(font,b,{"kern":True,"liga":True})
gs=TTFont(io.BytesIO(data)).getGlyphSet(); order=TTFont(io.BytesIO(data)).getGlyphOrder()
LS=-0.01*upem   # letter-spacing -.01em (Chrome adds it after every glyph, incl. last; we trim the trailing one)
x=0; d=""; bp=BoundsPen(gs)
pen=SVGPathPen(gs)
for i,(info,pos) in enumerate(zip(b.glyph_infos,b.glyph_positions)):
    name=order[info.codepoint]
    tp=TransformPen(pen,(1,0,0,-1,x+pos.x_offset,-pos.y_offset))  # flip y
    gs[name].draw(tp)
    gs[name].draw(TransformPen(bp,(1,0,0,-1,x+pos.x_offset,-pos.y_offset)))
    x+=pos.x_advance+(LS if i<len(b.glyph_infos)-1 else 0)
d=pen.getCommands(); x0,y0,x1,y1=bp.bounds
os2=inst["OS/2"]; hhea=inst["hhea"]
meta=dict(upem=upem,advance=x,bounds=[x0,y0,x1,y1],capHeight=os2.sCapHeight,ascender=hhea.ascent,descender=hhea.descent)
json.dump(dict(d=d,**meta),open("work/wordmark.json","w")); print(meta)
