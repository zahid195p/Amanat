# Generates the app icons in public/ (run: python3 scripts/make-icons.py)
from PIL import Image, ImageDraw, ImageFont
import glob, os
INK=(23,33,44); SIGN=(255,194,26)
cands=[p for p in glob.glob('/usr/share/fonts/truetype/**/*.ttf',recursive=True) if 'Bold' in p and 'Italic' not in p and 'Oblique' not in p and ('Condensed' in p or 'Liberation' in p or 'DejaVu' in p)]
font_path=[p for p in cands if p.endswith('DejaVuSans-Bold.ttf')][0] if any(p.endswith('DejaVuSans-Bold.ttf') for p in cands) else cands[0]
def icon(size,pad):
    im=Image.new('RGB',(size,size),INK); d=ImageDraw.Draw(im)
    s=size; m=int(s*pad)
    # luggage tag: rounded rectangle with a punched hole on the left
    box=[m, int(s*0.30), s-m, int(s*0.70)]
    d.rounded_rectangle(box, radius=int(s*0.07), fill=SIGN)
    r=int(s*0.045); cx=m+int(s*0.09); cy=s//2
    d.ellipse([cx-r,cy-r,cx+r,cy+r], fill=INK)
    f=ImageFont.truetype(font_path,int(s*0.27))
    d.text((cx + (box[2] - cx) / 2, cy), 'A', font=f, fill=INK, anchor='mm')
    return im
os.makedirs('public',exist_ok=True)
icon(192,0.12).save('public/icon-192.png')
icon(512,0.12).save('public/icon-512.png')
icon(512,0.22).save('public/icon-maskable-512.png')
icon(180,0.12).save('public/apple-touch-icon.png')
icon(64,0.08).save('public/favicon.png')
print('icons made with',font_path)
