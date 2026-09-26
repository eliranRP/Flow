# crop a tall screenshot to its content (bottom padding kept). usage: python crop.py file.png
import sys
from PIL import Image
for f in sys.argv[1:]:
    im = Image.open(f).convert("RGB"); w, h = im.size; bg = im.getpixel((4, h - 4))
    px = im.load(); last = 0
    for y in range(h - 1, 0, -2):
        if any(px[x, y] != bg for x in range(0, w, 3)): last = y; break
    im.crop((0, 0, w, min(h, last + 112))).save(f)
