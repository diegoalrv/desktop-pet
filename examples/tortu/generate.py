import zlib, struct, math, sys
F = 64
OUT = sys.argv[1]
SKIN, SKIN_D = (104, 196, 124), (66, 150, 92)
SHELL, SHELL_D, SHELL_L = (214, 142, 56), (140, 84, 30), (240, 184, 98)
BELLY = (246, 232, 190)
INK, WHITE = (30, 36, 34), (255, 255, 255)
# accesorios
PAPER, PAPER_D, RED, RED_D = (250, 246, 232), (196, 188, 166), (220, 64, 64), (150, 36, 40)
WOOD, WOOD_D, GOLD, TEA = (176, 112, 60), (110, 66, 32), (255, 214, 60), (150, 90, 40)
BLUE, PURPLE, GREY, STEAM = (70, 140, 230), (160, 90, 220), (90, 96, 104), (220, 226, 232)

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
    def line(s, x0, y0, x1, y1, c):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1): s.put(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c)

def leg(c, x, top, length, lift=0):
    c.rect(x - 3, top, x + 3, top + length - lift, SKIN_D)
    c.rect(x - 3, top + length - lift - 2, x + 3, top + length - lift, INK if False else SKIN_D)
    c.rect(x - 2, top, x + 2, top + length - lift - 1, SKIN)

def turtle(bob=0, legs=(0, 0, 0, 0), leglen=11, head=(0, 0), eyes="open", arms_up=False, tuck=0, dy=0, zz=0, sparkle=0, hang=False, props=None, arm=None):
    c = C()
    by = 60 - 24 + bob + dy                    # centro del caparazón
    ground_top = by + 8
    # cola
    c.ell(10, by + 9, 5, 3, SKIN_D)
    # patas traseras / delanteras (detrás del caparazón)
    xs = (18, 26, 38, 45)
    for i, x in enumerate(xs):
        if (arms_up or (arm and i == 3)) and i >= 2:
            c.rect(x - 2 + 2, ground_top - 10, x + 3, ground_top - 2, SKIN)   # brazos arriba
            c.ell(x + 3, ground_top - 11, 3, 3, SKIN)
        else:
            L = leglen + (4 if hang else 0)
            leg(c, x + (2 * i - 3 if hang else 0), ground_top - 2, L - 0, legs[i])
    # caparazón: borde, cuerpo y plastrón
    c.ell(30, by, 21, 17, SHELL_D, clip=lambda x, y: y <= ground_top)
    c.ell(30, by, 19, 15, SHELL, clip=lambda x, y: y <= ground_top - 1)
    c.rect(11, ground_top - 1, 49, ground_top + 1, BELLY)
    for cx, cy, r in ((30, by - 7, 6), (19, by - 2, 5), (41, by - 2, 5)):
        c.ell(cx, cy, r, r - 1, SHELL_L)
        c.ell(cx, cy, r - 2, r - 3, SHELL)
    c.line(24, by - 4, 21, by - 1, SHELL_D); c.line(36, by - 4, 39, by - 1, SHELL_D)
    # cabeza
    hx, hy = 50 - tuck + head[0], by + 2 + head[1] - (0 if tuck else 0)
    c.ell(hx, hy, 9 - tuck // 2, 8 - tuck // 3, SKIN_D)
    c.ell(hx, hy, 8 - tuck // 2, 7 - tuck // 3, SKIN)
    ex, ey = hx + 3, hy - 2
    if eyes == "open":
        c.ell(ex, ey, 3, 3, WHITE); c.put(ex + 1, ey, INK); c.put(ex + 1, ey + 1, INK)
    elif eyes == "closed":
        c.line(ex - 2, ey + 1, ex + 2, ey + 1, INK)
    elif eyes == "happy":
        c.line(ex - 2, ey + 1, ex, ey - 1, INK); c.line(ex, ey - 1, ex + 2, ey + 1, INK)
    elif eyes == "focus":
        c.ell(ex, ey, 3, 2, WHITE); c.put(ex + 1, ey + 1, INK); c.line(ex - 3, ey - 3, ex + 2, ey - 2, INK)
    elif eyes == "wide":
        c.ell(ex, ey, 4, 4, WHITE); c.put(ex + 1, ey, INK)
    elif eyes == "down":                                                  # mirando hacia abajo (leer/escribir)
        c.ell(ex, ey, 3, 2, WHITE); c.put(ex + 1, ey + 1, INK); c.put(ex, ey + 1, INK)
    elif eyes == "shades":                                                # lentes oscuros
        c.rect(ex - 4, ey - 2, ex + 3, ey + 1, INK); c.line(ex - 8, ey - 2, ex - 4, ey - 2, INK)
        c.put(ex - 2, ey - 1, (120, 130, 140)); c.put(ex + 1, ey - 1, (120, 130, 140))
    if eyes != "closed" or True:
        c.line(hx + 3, hy + 3, hx + 6, hy + 3, INK)                      # boca
    c.put(hx + 7, hy, SKIN_D)                                            # nariz
    if arms_up:                                                          # brazos arriba, por delante del caparazón
        for ax in (36, 44):
            c.rect(ax, by - 14, ax + 2, by - 1, SKIN); c.ell(ax + 1, by - 15, 2, 2, SKIN)
    if arm:                                                              # brazo delantero hasta un punto (sostiene algo)
        (ax0, ay0), (ax1, ay1) = (44, ground_top - 3), arm
        for t in range(3): c.line(ax0, ay0 + t - 1, ax1, ay1 + t - 1, SKIN)
        c.ell(ax1, ay1, 2, 2, SKIN)
    if props: props(c, by, hx, hy)
    for i in range(zz):                                                  # Z de sueño
        zx, zy = 54 + i * 4, 18 - i * 6 + (0)
        c.line(zx, zy, zx + 3, zy, INK); c.line(zx + 3, zy, zx, zy + 3, INK); c.line(zx, zy + 3, zx + 3, zy + 3, INK)
    for i in range(sparkle):                                             # destellos
        sx, sy = [(8, 14), (56, 10), (50, 26), (14, 28)][i]
        c.line(sx - 2, sy, sx + 2, sy, (255, 214, 60)); c.line(sx, sy - 2, sx, sy + 2, (255, 214, 60))
    return c.p

def note(c, x, y, col):                                                  # corchea
    c.rect(x, y + 3, x + 2, y + 4, col); c.line(x + 2, y - 2, x + 2, y + 3, col); c.line(x + 3, y - 2, x + 4, y - 1, col)

def notes(c, i):                                                        # notas que suben a la izquierda (no las tapa el timer)
    for k, col in enumerate((GOLD, BLUE, PURPLE)):
        ph = (i + k * 2) % 6
        note(c, 3 + k * 4, 34 - ph * 3, col)

def book(c, x, y, flip):                                                # libro abierto, de perfil hacia la cara
    c.rect(x - 1, y - 1, x + 12, y + 7, RED_D); c.rect(x, y, x + 11, y + 6, PAPER)
    c.line(x + 6, y, x + 6, y + 6, PAPER_D)
    for ly in (y + 2, y + 4): c.line(x + 1, ly, x + 4, ly, PAPER_D); c.line(x + 8, ly, x + 10, ly, PAPER_D)
    if flip: c.line(x + 6, y - 3, x + 9 + flip, y - 1, PAPER); c.line(x + 6, y - 2, x + 9 + flip, y, PAPER_D)

def headphones(c, hx, hy):
    for x in range(hx - 8, hx + 4): c.put(x, hy - 9 + (1 if x in (hx - 8, hx + 3) else 0), GREY)
    c.line(hx - 8, hy - 8, hx - 9, hy - 2, GREY)
    c.rect(hx - 10, hy - 3, hx - 6, hy + 3, INK); c.rect(hx - 9, hy - 2, hx - 7, hy + 2, RED)

def idle(i):   return turtle(bob=(0, 1, 1, 0)[i], eyes="closed" if i == 3 else "open", head=(0, (0, 0, 1, 0)[i]))
def walk(i):
    ph = i / 6 * 2 * math.pi
    lifts = [max(0, round(3 * math.sin(ph + k * math.pi / 2))) for k in range(4)]
    return turtle(bob=round(math.sin(ph * 2)), legs=lifts, head=(1, 0))
def focus(i):  return turtle(bob=(0, 0, 1, 1)[i], eyes="focus", head=(1, 1))
def celeb(i):  return turtle(dy=-round(10 * abs(math.sin(i / 6 * math.pi))), arms_up=True, eyes="happy", sparkle=1 + i % 4, legs=(0, 0, 0, 0))
def sleep(i):  return turtle(bob=(0, 1, 1, 0)[i], eyes="closed", tuck=6, head=(-2, 2), zz=1 + i % 3, leglen=9)
def drag(i):   return turtle(eyes="wide", hang=True, head=(0, -1 + i), bob=i)

# --- ánimos (variantes que la app alterna según estado y música) ---
def read(i):                                                            # concentración: lee, pasa página en el frame 2
    return turtle(bob=(0, 0, 1, 0)[i], eyes="down", head=(0, 1), arm=(52, 46),
                  props=lambda c, by, hx, hy: book(c, 50, hy + 4, (0, 0, 2, 1)[i]))
def write(i):                                                           # concentración: escribe en una hoja en el suelo
    def p(c, by, hx, hy):
        c.rect(48, 53, 63, 55, PAPER_D); c.rect(48, 52, 63, 54, PAPER)
        for k in range(i + 1): c.line(50, 53 - (k % 2), 50 + 3 * k, 53 - (k % 2), INK)
        px = 50 + 3 * i
        c.line(px, 51, px + 4, 43, GOLD); c.put(px, 51, INK); c.put(px + 4, 43, (240, 140, 160))
    return turtle(bob=(0, 0, 0, 1)[i], eyes="down", head=(1, 3), arm=(54 + 3 * i // 2, 46), props=p)
def tea(i):                                                             # pausa: té con vapor, sorbo en el frame 3
    sip = i == 3
    def p(c, by, hx, hy):
        cx, cy = (56, hy + 2) if sip else (55, hy + 7)
        c.rect(cx, cy, cx + 5, cy + 5, WHITE); c.rect(cx + 1, cy, cx + 4, cy, TEA); c.rect(cx + 6, cy + 1, cx + 7, cy + 3, WHITE)
        for k in range(3): c.put(cx + 1 + k * 2 + ((i + k) % 2), cy - 2 - k - (i % 2) * 2, STEAM)
    return turtle(bob=(0, 1, 1, 0)[i], eyes="happy" if sip else "closed", head=(0, -1 if sip else 0),
                  arm=(57, 44) if sip else (55, 48), props=p)
def guitar(i):                                                          # música: guitarra, lentes oscuros, headbang
    def p(c, by, hx, hy):
        c.line(44, 44, 22, 29, WOOD_D); c.line(44, 45, 22, 30, WOOD_D); c.line(43, 44, 22, 29, WOOD)
        c.rect(19, 26, 23, 29, INK)
        for k in range(3): c.put(20 + k, 25, GOLD)
        c.ell(47, 47, 7, 6, RED_D); c.ell(47, 47, 6, 5, RED); c.ell(46, 47, 2, 2, INK)
        notes(c, i)
    return turtle(bob=0, eyes="shades", head=(1, (0, 3, 0, 3)[i]), arm=(48 + (0, 2, 0, 2)[i], 45 - (0, 2, 0, 2)[i]), props=p)
def maracas(i):                                                         # música: maracas arriba, bailando
    def p(c, by, hx, hy):
        for k, (ax, col) in enumerate(((37, GOLD), (45, PURPLE))):
            sh = (1 if (i + k) % 2 else -1)
            c.line(ax + 1, by - 15, ax + 1 + sh, by - 19, WOOD_D)
            c.ell(ax + 1 + sh * 2, by - 22, 3, 4, col); c.put(ax + sh * 2, by - 23, WHITE)
        notes(c, i)
    return turtle(bob=(0, 2, 0, 2)[i], eyes="shades", arms_up=True, head=(0, (0, 1, 0, 1)[i]), props=p)
def listen(i):                                                          # concentración + música: audífonos, sigue el ritmo
    return turtle(bob=(0, 1, 0, 1)[i], eyes="focus", head=(1, (1, 2, 1, 2)[i]),
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

# vista previa ampliada x4 con todas las filas
rows = []
maxn = 6
for name, (fn, n) in anims.items():
    sh = sheet(fn, n)
    for y in range(F): rows.append(sh[y] + [(235, 235, 240, 255)] * (F * (maxn - n)))
big = [[px for px in r for _ in range(3)] for r in rows for _ in range(3)]
png(sys.argv[2], F * maxn * 3, len(rows) * 3, [[(235,235,240,255) if p[3]==0 else p for p in r] for r in big])
