import json, base64, subprocess, os, time, sys
sys.path.insert(0,'/workspace/flow-logo')
from render_sheet import shot
import cairosvg
V='#7B3FE4'; V2='#B894FF'; TXT='#1D1728'; DARK='#15111E'; TINT='#F3ECFE'; W='#FFFFFF'
WM=json.load(open('/workspace/flow-logo/round3/work/wordmark.json'))
def wordmark_svg(color, height=None, pad=0):
    x0,y0,x1,y1=WM['bounds']; w=x1-x0; h=y1-y0
    vb=f"{x0-pad} {y0-pad} {w+2*pad} {h+2*pad}"
    sz=f' height="{height}" width="{height*(w+2*pad)/(h+2*pad):.1f}"' if height else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{sz}><title>Flow</title><path fill="{color}" d="{WM["d"]}"/></svg>'
def raster(svg,w,h=None):
    return cairosvg.svg2png(bytestring=svg.encode(),output_width=w,output_height=h or w)
def uri(png): return "data:image/png;base64,"+base64.b64encode(png).decode()
