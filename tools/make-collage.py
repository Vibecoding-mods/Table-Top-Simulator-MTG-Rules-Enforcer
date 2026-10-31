# Collage of the Arena-style table features, from TTS-window screenshots (tools/effect-shots.js and others).
#   python tools/make-collage.py  -> tmp/collage/arena-features.jpg
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
T = lambda p: os.path.join(ROOT, "tmp", p)
TILES = [
    ("collage/turn-1.jpg", (380, 0, 1920, 1009), "Your turn: gold banner, phase bar, big Pass priority button"),
    ("collage/turn-1.jpg", (1080, 840, 1920, 1009), "Cards you can play glow green in your hand"),
    ("collage/attack-1.jpg", (480, 360, 1560, 830), "Their turn (blue-white banner); red attack arrow to your life"),
    ("collage/attack-1.jpg", (980, 560, 1920, 1009), "Blocks: your possible blocker glows green, hint + Confirm"),
    ("collage/target-2.jpg", (480, 140, 1920, 830), "Cyan target arc, stack pop-up of the spell, red = picked"),
    ("collage/target-1.jpg", (520, 150, 1400, 1009), "A question about a card shows the card, with its buttons"),
    ("collage/choice-1.jpg", (480, 250, 1440, 760), "Multi-colour land: which mana? as buttons in the middle"),
    ("collage/stage-sylvan.jpg", (560, 200, 1360, 700), "Sylvan Library: pay 4 life or put back (shown on demand)"),
    ("m5-live2.jpg", (860, 400, 1150, 620), "Life change on the counter: -8 (two hits added up)"),
    ("collage/block-1.jpg", (1380, 600, 1600, 830), "A creature dies: its graveyard flashes violet"),
    ("collage/stage-badges.jpg", (990, 575, 1320, 715), "Badges: P/T blue raised / red damaged, counters, x3 tokens (demo)"),
    ("collage/stage-victory.jpg", (560, 200, 1360, 700), "VICTORY / DEFEAT banner at game end (shown on demand)"),
    ("collage/stage-countered.jpg", (1600, 220, 1910, 650), "COUNTERED on the stack pop-up (shown on demand)"),
    ("collage/stage-scoop.jpg", (560, 200, 1360, 700), "Scoop: big \"Concede this game?\" box (shown on demand)"),
    ("collage/turn-1.jpg", (760, 100, 1280, 160), "Scoop button beside your name, only during a game"),
]
TW, TH, CAP, COLS, PAD = 640, 360, 44, 3, 10
rows = (len(TILES) + COLS - 1) // COLS
W = COLS * TW + (COLS + 1) * PAD
H = 90 + rows * (TH + CAP + PAD) + PAD
out = Image.new("RGB", (W, H), (18, 20, 26))
d = ImageDraw.Draw(out)
def font(size):
    for f in ("segoeuib.ttf", "arialbd.ttf", "arial.ttf"):
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()
title, cap = font(40), font(19)
d.text((PAD + 6, 22), "MTG Arena feel on the TTS Commander table (screenshots from TTS, 2026-10-22)", fill=(255, 210, 122), font=title)
for i, (src, box, text) in enumerate(TILES):
    im = Image.open(T(src)).convert("RGB").crop(box)
    im.thumbnail((TW, TH), Image.LANCZOS)
    x = PAD + (i % COLS) * (TW + PAD)
    y = 90 + (i // COLS) * (TH + CAP + PAD)
    d.rectangle([x, y, x + TW - 1, y + TH - 1], fill=(0, 0, 0))
    out.paste(im, (x + (TW - im.width) // 2, y + (TH - im.height) // 2))
    d.rectangle([x, y + TH, x + TW - 1, y + TH + CAP - 1], fill=(34, 38, 50))
    d.text((x + 10, y + TH + 11), f"{i + 1}. {text}", fill=(235, 238, 245), font=cap)
out.save(T("collage/arena-features.jpg"), quality=88)
print(T("collage/arena-features.jpg"), out.size)
