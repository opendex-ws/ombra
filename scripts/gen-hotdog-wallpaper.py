"""Procedural Mondrian wallpaper in the Hotdog Stand palette (#dd0000 / #ffff00 /
white / black) — the theme has no photographic equivalent, so it is generated."""
import pathlib
import random
from PIL import Image, ImageDraw

RED, YEL, WHT, BLK = (0xdd,0,0), (0xff,0xff,0), (0xff,0xff,0xff), (0,0,0)

def compose(seed, W=1920, H=1080):
    rnd = random.Random(seed)
    rects = [(0, 0, W, H)]
    # recursive guillotine splits, biased away from thin slivers
    for _ in range(6):
        out = []
        for (x, y, w, h) in rects:
            if w * h < (W * H) * 0.035 or rnd.random() < 0.28:
                out.append((x, y, w, h)); continue
            if w >= h:
                c = int(w * rnd.uniform(0.3, 0.7))
                out += [(x, y, c, h), (x + c, y, w - c, h)]
            else:
                c = int(h * rnd.uniform(0.3, 0.7))
                out += [(x, y, w, c), (x, y + c, w, h - c)]
        rects = out
    img = Image.new('RGB', (W, H), WHT)
    d = ImageDraw.Draw(img)
    rects.sort(key=lambda r: -r[2] * r[3])
    # a few big colour blocks, the rest white — Mondrian keeps colour sparse
    palette = [RED, YEL, RED, WHT, YEL, WHT, RED, WHT, WHT, YEL]
    for i, (x, y, w, h) in enumerate(rects):
        col = palette[i % len(palette)] if i < 9 and rnd.random() < 0.8 else WHT
        d.rectangle([x, y, x + w, y + h], fill=col)
    lw = 16
    for (x, y, w, h) in rects:
        d.rectangle([x, y, x + w, y + h], outline=BLK, width=lw)
    d.rectangle([0, 0, W - 1, H - 1], outline=BLK, width=lw * 2)
    return img

# Regenerate: python3 scripts/gen-hotdog-wallpaper.py
# Seed 21 keeps large calm fields, which sit better behind the UI than a busy
# composition. Change SEED to reroll.
if __name__ == '__main__':
    SEED = 21
    out = pathlib.Path(__file__).resolve().parents[1] / 'static' / 'wallpapers'
    img = compose(SEED, 1920, 1080)
    img.save(out / 'hotdog-stand.webp', 'WEBP', quality=92, method=6)
    th = img.copy(); th.thumbnail((480, 480))
    th.save(out / 'thumb' / 'hotdog-stand.webp', 'WEBP', quality=80, method=6)
    print('wrote hotdog-stand.webp')
