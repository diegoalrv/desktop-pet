import zlib, struct, math, sys
# Candolita: perrita negra con pañoleta de cuadritos. Mismas animaciones que tortu.
# uso: python3 generate.py <carpeta_salida> <preview.png>
F = 64
OUT = sys.argv[1]
FUR, FUR_D, FUR_L, LINE = (50, 50, 58), (32, 32, 38), (92, 94, 110), (12, 12, 16)
EYE, NOSE, TONGUE, LID = (120, 76, 38), (8, 8, 10), (240, 120, 140), (160, 160, 176)
PATCH = ((250, 206, 50), (226, 70, 60), (80, 170, 90), (70, 140, 230), (240, 140, 40))  # pañoleta
INK, WHITE = (30, 36, 34), (255, 255, 255)
# accesorios
PAPER, PAPER_D, RED, RED_D = (250, 246, 232), (196, 188, 166), (220, 64, 64), (150, 36, 40)
WOOD, WOOD_D, GOLD, TEA = (176, 112, 60), (110, 66, 32), (255, 214, 60), (150, 90, 40)
BLUE, PURPLE, GREY, STEAM = (70, 140, 230), (160, 90, 220), (170, 176, 186), (220, 226, 232)

class C:
    def __init__(s): s.p = [[(0, 0, 0, 0)] * F for _ in range(F)]
    def put(s, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < F and 0 <= y < F: s.p[y][x] = (*c, 255)
    def ell(s, cx, cy, rx, ry, c, clip=None):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 and (clip is None or clip(x, y)): s.put(x, y, c)
    def rect(s, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1): s.put(x, y, c)
    def line(s, x0, y0, x1, y1, c, w=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            if w == 1: s.put(x, y, c)
            else: s.rect(x - w // 2, y - w // 2, x + (w - 1) // 2, y + (w - 1) // 2, c)
    def poly(s, pts, c, fill=None):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                inside = False
                for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
                    if (y0 > y + .5) != (y1 > y + .5) and x + .5 < x0 + (y + .5 - y0) * (x1 - x0) / (y1 - y0): inside = not inside
                if inside: s.put(x, y, fill(x, y) if fill else c)
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]): s.line(x0, y0, x1, y1, LINE)

def limb(c, x0, y0, x1, y1, col=FUR):                                   # pata gruesa con contorno y pata/almohadilla
    c.line(x0, y0, x1, y1, LINE, 5); c.ell(x1, y1, 3, 2.5, LINE)
    c.line(x0, y0, x1, y1, col, 3); c.ell(x1, y1, 2, 1.5, col)

def patch(x, y): return PATCH[(x // 2 + y // 2) % len(PATCH)]

def dog(bob=0, legs=(0, 0, 0, 0), leglen=12, head=(0, 0), eyes="open", arms_up=False, tuck=0, dy=0, zz=0, sparkle=0,
        hang=False, props=None, arm=None, wag=0, tongue=False):
    c = C()
    lying = tuck > 0
    by = 38 + bob + dy + (9 if lying else 0)                           # centro del cuerpo
    foot = by + 4 + leglen + (4 if hang else 0)
    # cola (se mueve con wag)
    tip = (6, by + 4) if lying else (8 + wag, by - 11 + abs(wag) // 2)
    c.line(16, by - 3, tip[0], tip[1], LINE, 4); c.line(16, by - 3, tip[0], tip[1], FUR, 2)
    # patas: 0 trasera cerca, 1 trasera lejos, 2 delantera lejos, 3 delantera cerca
    xs = (19, 23, 38, 42)
    if lying:
        c.ell(21, by + 4, 6, 4, LINE); c.ell(21, by + 4, 5, 3, FUR_D)
        for k, y in enumerate((by + 6, by + 4)): limb(c, 40, y, 51 - k * 2, y + 1, FUR_D if k else FUR)
    else:
        for i in (1, 2, 0, 3):                                          # las lejanas primero, más oscuras
            if i >= 2 and (arms_up or (arm and i == 3)): continue
            x = xs[i] + (2 * i - 3 if hang else 0)
            limb(c, x, by + 2, x + legs[i] // 2, foot - legs[i], FUR_D if i in (1, 2) else FUR)
    # cuerpo y cuello
    c.ell(30, by, 16, 8, LINE); c.ell(30, by, 15, 7, FUR)
    c.line(20, by - 6, 38, by - 6, FUR_L)
    hx, hy = (47, by - 3) if lying else (46 + head[0], by - 12 + head[1])
    if not lying:
        c.ell(43, by - 4, 5, 6, LINE); c.ell(43, by - 4, 4, 5, FUR)
        c.line(hx - 3, hy + 2, 43, by - 2, FUR, 6)
    # oreja semicaída (detrás de la cabeza)
    c.poly([(hx - 7, hy - 3), (hx - 7, hy - 10), (hx - 3, hy - 14), (hx + 2, hy - 11), (hx + 3, hy - 7), (hx - 1, hy - 9), (hx - 1, hy - 3)], FUR_D)
    # cabeza + hocico
    c.ell(hx, hy, 8, 7, LINE); c.ell(hx + 8, hy + 2, 5.5, 3.6, LINE)
    c.ell(hx, hy, 7, 6, FUR); c.ell(hx + 8, hy + 2, 4.5, 2.6, FUR)
    c.line(hx - 3, hy - 4, hx + 1, hy - 5, FUR_L)                       # brillo
    c.ell(hx + 12, hy + 1, 1.6, 1.6, NOSE); c.put(hx + 12, hy, LID)
    c.line(hx + 7, hy + 4, hx + 11, hy + 4, LINE)
    if tongue: c.rect(hx + 8, hy + 5, hx + 9, hy + 7, TONGUE); c.put(hx + 9, hy + 7, (200, 80, 100))
    # pañoleta de cuadritos
    c.poly([(hx - 8, hy + 5), (hx + 3, hy + 6), (hx - 4, hy + 15)], None, patch)
    # ojos (claros sobre pelo negro)
    ex, ey = hx + 3, hy - 1
    if eyes == "open":
        c.ell(ex, ey, 2, 2, EYE); c.rect(ex, ey, ex + 1, ey + 1, LINE); c.put(ex, ey - 1, WHITE)
    elif eyes == "closed":
        c.line(ex - 2, ey + 1, ex + 1, ey + 1, LID)
    elif eyes == "happy":
        c.line(ex - 2, ey + 1, ex - 1, ey - 1, LID); c.line(ex - 1, ey - 1, ex + 1, ey + 1, LID)
    elif eyes == "focus":
        c.ell(ex, ey, 1.6, 1.2, EYE); c.put(ex, ey, LINE); c.put(ex + 1, ey - 1, WHITE); c.line(ex - 2, ey - 3, ex + 2, ey - 2, LID)
    elif eyes == "wide":
        c.ell(ex, ey, 2.5, 2.5, WHITE); c.put(ex + 1, ey, LINE); c.put(ex, ey, LINE)
    elif eyes == "down":
        c.ell(ex, ey + 1, 1.6, 1.2, EYE); c.put(ex + 1, ey + 1, LINE); c.line(ex - 2, ey - 1, ex + 1, ey - 1, LID)
    elif eyes == "shades":                                              # lentes oscuros con marco claro
        c.rect(ex - 3, ey - 2, ex + 3, ey + 1, GREY); c.rect(ex - 2, ey - 1, ex + 2, ey, LINE)
        c.line(ex - 8, ey - 2, ex - 3, ey - 2, GREY); c.put(ex + 1, ey - 1, WHITE)
    if arms_up:                                                         # patas delanteras arriba
        for ax in (37, 44): limb(c, 41, by, ax + 1, by - 14, FUR_D if ax == 37 else FUR)
    if arm:                                                             # pata delantera hasta un punto (sostiene algo)
        limb(c, 41, by + 1, *(arm(hx, hy) if callable(arm) else arm))
    if props: props(c, by, hx, hy)
    for i in range(zz):                                                 # Z de sueño
        zx, zy = 54 + i * 4, 30 - i * 6
        c.line(zx, zy, zx + 3, zy, INK); c.line(zx + 3, zy, zx, zy + 3, INK); c.line(zx, zy + 3, zx + 3, zy + 3, INK)
    for i in range(sparkle):                                            # destellos
        sx, sy = [(8, 14), (58, 8), (56, 30), (12, 28)][i]
        c.line(sx - 2, sy, sx + 2, sy, GOLD); c.line(sx, sy - 2, sx, sy + 2, GOLD)
    return c.p

def note(c, x, y, col):                                                  # corchea
    c.rect(x, y + 3, x + 2, y + 4, col); c.line(x + 2, y - 2, x + 2, y + 3, col); c.line(x + 3, y - 2, x + 4, y - 1, col)

def notes(c, i):                                                        # notas que suben a la izquierda (no las tapa el timer)
    for k, col in enumerate((GOLD, BLUE, PURPLE)):
        ph = (i + k * 2) % 6
        note(c, 3 + k * 4, 30 - ph * 3, col)

def book(c, x, y, flip):                                                # libro abierto
    c.rect(x - 1, y - 1, x + 12, y + 7, RED_D); c.rect(x, y, x + 11, y + 6, PAPER)
    c.line(x + 6, y, x + 6, y + 6, PAPER_D)
    for ly in (y + 2, y + 4): c.line(x + 1, ly, x + 4, ly, PAPER_D); c.line(x + 8, ly, x + 10, ly, PAPER_D)
    if flip: c.line(x + 6, y - 3, x + 9 + flip, y - 1, PAPER); c.line(x + 6, y - 2, x + 9 + flip, y, PAPER_D)

def headphones(c, hx, hy):
    c.line(hx - 5, hy - 5, hx - 3, hy - 8, GREY, 2); c.line(hx - 3, hy - 8, hx + 3, hy - 7, GREY, 2); c.line(hx + 3, hy - 7, hx + 4, hy - 5, GREY, 2)
    c.rect(hx - 7, hy - 4, hx - 3, hy + 2, INK); c.rect(hx - 6, hy - 3, hx - 4, hy + 1, RED)

def idle(i):   return dog(bob=(0, 1, 1, 0)[i], eyes="closed" if i == 3 else "open", head=(0, (0, 0, 1, 0)[i]), wag=(0, 2, 0, -2)[i])
def walk(i):
    ph = i / 6 * 2 * math.pi
    lifts = [max(0, round(3 * math.sin(ph + o))) for o in (0, math.pi, 0, math.pi)]  # pares en diagonal
    return dog(bob=round(math.sin(ph * 2)), legs=lifts, head=(1, 0), wag=(2, 0, -2, 0, 2, 0)[i], tongue=True)
def focus(i):  return dog(bob=(0, 0, 1, 1)[i], eyes="focus", head=(1, 1))
def celeb(i):  return dog(dy=-round(10 * abs(math.sin(i / 6 * math.pi))), hang=i in (1, 2, 3, 4), eyes="happy", sparkle=1 + i % 4,
                          wag=(3, -3)[i % 2], tongue=True)
def sleep(i):  return dog(bob=(0, 1, 1, 0)[i], eyes="closed", tuck=6, zz=1 + i % 3)
def drag(i):   return dog(eyes="wide", hang=True, head=(0, -1 + i), bob=i, wag=-2)

# --- ánimos (variantes que la app alterna según estado y música) ---
def read(i):                                                            # concentración: lee, pasa página en el frame 2
    return dog(bob=(0, 0, 1, 0)[i], eyes="down", head=(0, 1), arm=lambda hx, hy: (hx + 6, hy + 12),
               props=lambda c, by, hx, hy: book(c, hx + 2, hy + 8, (0, 0, 2, 1)[i]))
def write(i):                                                           # concentración: escribe en una hoja en el suelo
    def p(c, by, hx, hy):
        c.rect(48, 53, 63, 55, PAPER_D); c.rect(48, 52, 63, 54, PAPER)
        for k in range(i + 1): c.line(50, 53 - (k % 2), 50 + 3 * k, 53 - (k % 2), INK)
        px = 50 + 3 * i
        c.line(px, 51, px + 4, 43, GOLD); c.put(px, 51, INK); c.put(px + 4, 43, (240, 140, 160))
    return dog(bob=(0, 0, 0, 1)[i], eyes="down", head=(1, 4), arm=(54 + 3 * i // 2, 46), props=p)
def tea(i):                                                             # pausa: té con vapor, sorbo en el frame 3
    sip = i == 3
    def p(c, by, hx, hy):
        cx, cy = (hx + 9, hy + 3) if sip else (hx + 8, hy + 8)
        c.rect(cx, cy, cx + 5, cy + 5, WHITE); c.rect(cx + 1, cy, cx + 4, cy, TEA); c.rect(cx + 6, cy + 1, cx + 7, cy + 3, WHITE)
        for k in range(3): c.put(cx + 1 + k * 2 + ((i + k) % 2), cy - 2 - k - (i % 2) * 2, STEAM)
    return dog(bob=(0, 1, 1, 0)[i], eyes="happy" if sip else "closed", head=(0, -1 if sip else 0),
               arm=(lambda hx, hy: (hx + 9, hy + 7)) if sip else (lambda hx, hy: (hx + 8, hy + 12)), props=p)
def guitar(i):                                                          # música: guitarra, lentes oscuros, headbang
    def p(c, by, hx, hy):
        c.line(44, 46, 20, 30, WOOD_D, 2); c.line(43, 45, 21, 30, WOOD)
        c.rect(17, 27, 21, 30, INK)
        for k in range(3): c.put(18 + k, 26, GOLD)
        c.ell(47, 48, 7, 6, RED_D); c.ell(47, 48, 6, 5, RED); c.ell(46, 48, 2, 2, INK)
        limb(c, 41, by + 1, 48 + (0, 2, 0, 2)[i], 46 - (0, 2, 0, 2)[i])
        notes(c, i)
    return dog(bob=0, eyes="shades", head=(1, (0, 3, 0, 3)[i]), wag=(2, -2)[i % 2], props=p)
def maracas(i):                                                         # música: una maraca en la pata, otra en la cola
    sh = 1 if i % 2 else -1
    def p(c, by, hx, hy):
        mx, my = hx + 11, hy + 6 + sh
        c.line(mx, my, mx + 1 + sh, my - 5, WOOD_D); c.ell(mx + 1 + sh * 2, my - 8, 3, 4, GOLD); c.put(mx + sh * 2, my - 9, WHITE)
        tx, ty = 8 + 3 * sh, by - 11
        c.ell(tx - sh, ty - 4, 3, 4, PURPLE); c.put(tx - sh - 1, ty - 5, WHITE)
        notes(c, i)
    return dog(bob=(0, 2, 0, 2)[i], eyes="shades", head=(0, (0, 1, 0, 1)[i]), wag=3 * sh,
               arm=lambda hx, hy: (hx + 11, hy + 7 + sh), props=p)
def listen(i):                                                          # concentración + música: audífonos, sigue el ritmo
    return dog(bob=(0, 1, 0, 1)[i], eyes="focus", head=(1, (1, 2, 1, 2)[i]), wag=(1, -1)[i % 2],
               props=lambda c, by, hx, hy: headphones(c, hx, hy))

def png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rows)
    def ch(t, d): c = struct.pack(">I", len(d)) + t + d; return c + struct.pack(">I", zlib.crc32(t + d))
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw, 9)) + ch(b"IEND", b""))

def sheet(fn, n):
    frames = [fn(i) for i in range(n)]
    return [sum((frames[k][y] for k in range(n)), []) for y in range(F)]

anims = {"idle": (idle, 4), "walk": (walk, 6), "focus": (focus, 4), "celebrate": (celeb, 6), "sleep": (sleep, 4), "dragged": (drag, 2),
         "read": (read, 4), "write": (write, 4), "tea": (tea, 4), "guitar": (guitar, 4), "maracas": (maracas, 4), "listen": (listen, 4)}
for name, (fn, n) in anims.items(): png(f"{OUT}/{name}.png", F * n, F, sheet(fn, n))

# vista previa ampliada x3 con todas las filas (fondo claro)
rows = []
maxn = 6
for name, (fn, n) in anims.items():
    sh = sheet(fn, n)
    for y in range(F): rows.append(sh[y] + [(235, 235, 240, 255)] * (F * (maxn - n)))
big = [[px for px in r for _ in range(3)] for r in rows for _ in range(3)]
png(sys.argv[2], F * maxn * 3, len(rows) * 3, [[(235,235,240,255) if p[3]==0 else p for p in r] for r in big])
