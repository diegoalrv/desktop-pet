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

# --- expresiones: ojos, cejas y bocas dibujados a mano (k contorno, e iris, w brillo, l párpado) ---
IRIS, BROW, BLUSH = (156, 100, 52), (124, 126, 146), (226, 104, 134)
EYES = {  # 4 de ancho, la fila 0 cae en ey-2
    "open":    [".ee.", "ekwe", "ekke", ".ee."],
    "closed":  ["....", "....", "llll", "...."],          # parpadeo / dormida
    "happy":   ["....", ".ll.", "l..l", "...."],          # ^ ^
    "content": ["....", "l..l", ".ll.", "...."],          # ojos cerrados sonriendo
    "focus":   ["llll", "ekwe", ".ee.", "...."],          # párpado bajo, decidida
    "down":    ["....", "llll", "ekke", ".ew."],          # mira hacia abajo (lee, escribe)
    "wide":    [".www.", "wwkkw", "wwkkw", ".www."],      # sorpresa (5 de ancho)
    "sad":     ["....", ".ee.", "ekwe", ".ke."],          # pupila baja
    "half":    ["....", "llll", "ekwe", ".ee."],          # párpado a media asta: aburrida, esperando
}
BROWS = {  # filas ey-4 y ey-3
    "raise": [".bb.", "b..b"], "focus": ["bb..", "..bb"], "sad": ["..bb", "bb.."], "quirk": [".bbb", "b..."],
}
EAR = {"normal": (0, 0), "perk": (0, -1), "droop": (-2, 3), "flip": (5, -2)}

def stamp(c, x0, y0, rows, cols):
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch in cols: c.put(x0 + dx, y0 + dy, cols[ch])

def mouth(c, hx, hy, kind):                                             # comisura a la izquierda, nariz a la derecha
    y = hy + 3                                                          # una fila sobre el contorno del hocico
    if kind == "frown": c.put(hx + 7, y + 1, LINE); c.line(hx + 8, y, hx + 11, y, LINE)
    elif kind == "wobble":
        for k, dy in enumerate((1, 0, 1, 0, 0)): c.put(hx + 7 + k, y + dy, LINE)
    elif kind == "flat": c.line(hx + 7, y, hx + 11, y, LINE)
    elif kind == "snarl":                                               # gruñido: labio arriba y colmillos
        c.line(hx + 6, y, hx + 11, y, LINE); c.put(hx + 8, y + 1, WHITE); c.put(hx + 10, y + 1, WHITE)
        c.put(hx + 6, y - 4, LINE); c.put(hx + 7, y - 5, LINE)                         # arruga del hocico
    elif kind == "bark":                                                # ladrido: mandíbula abierta
        c.ell(hx + 8, y + 3, 4.5, 2.5, LINE); c.ell(hx + 8, y + 3, 3.5, 1.5, FUR)
        c.rect(hx + 6, y, hx + 11, y + 2, LINE); c.rect(hx + 7, y + 1, hx + 10, y + 1, (150, 50, 70))
        c.put(hx + 10, y + 2, TONGUE); c.put(hx + 9, y + 2, TONGUE); c.put(hx + 11, y, WHITE); c.put(hx + 11, y + 2, WHITE)
    elif kind == "o": c.line(hx + 7, y, hx + 11, y, LINE); c.rect(hx + 9, y + 1, hx + 10, y + 2, LINE); c.put(hx + 9, y + 1, (150, 50, 70))
    else:                                                               # smile / open
        c.put(hx + 7, y - 1, LINE); c.line(hx + 8, y, hx + 11, y, LINE)
        if kind == "open":
            c.rect(hx + 8, y + 1, hx + 10, y + 1, LINE)
            c.rect(hx + 8, y + 2, hx + 9, y + 3, TONGUE); c.put(hx + 9, y + 3, (200, 80, 100)); c.put(hx + 8, y + 2, (255, 170, 186))

def draw_head(c, hx, hy, eyes="open", tongue=False, brow=None, smile="smile", blush=False, ear="normal"):
    # oreja semicaída (detrás de la cabeza); se para o se cae según el ánimo
    ox, oy = EAR[ear]
    pts = [(-7, -3, 0), (-7, -10, .6), (-3, -14, 1), (2, -11, .8), (3, -7, .4), (-1, -9, .6), (-1, -3, 0)]
    c.poly([(hx + x + ox * w, hy + y + oy * w) for x, y, w in pts], FUR_D)
    # cabeza + hocico
    c.ell(hx, hy, 8, 7, LINE); c.ell(hx + 8, hy + 2, 5.5, 3.6, LINE)
    c.ell(hx, hy, 7, 6, FUR); c.ell(hx + 8, hy + 2, 4.5, 2.6, FUR)
    c.line(hx - 3, hy - 4, hx + 1, hy - 5, FUR_L)                       # brillo
    c.ell(hx + 12, hy + 1, 1.6, 1.6, NOSE); c.put(hx + 12, hy, LID)
    mouth(c, hx, hy, "open" if tongue else smile)
    # pañoleta de cuadritos
    c.poly([(hx - 8, hy + 5), (hx + 3, hy + 6), (hx - 4, hy + 15)], None, patch)
    ex, ey = hx + 3, hy - 1
    if blush: c.put(ex, ey + 3, BLUSH); c.put(ex + 1, ey + 3, BLUSH)
    if brow: stamp(c, ex - 1, ey - 4, BROWS[brow], {"b": BROW})
    if eyes == "shades":                                                # lentes oscuros con marco claro
        c.rect(ex - 3, ey - 2, ex + 3, ey + 1, GREY); c.rect(ex - 2, ey - 1, ex + 2, ey, LINE)
        c.line(ex - 8, ey - 2, ex - 3, ey - 2, GREY); c.put(ex + 1, ey - 1, WHITE)
    else:
        rows = EYES[eyes]
        stamp(c, ex - (2 if len(rows[0]) == 5 else 1), ey - 2, rows, {"k": LINE, "e": IRIS, "w": WHITE, "l": LID})

def dog(bob=0, legs=(0, 0, 0, 0), leglen=12, head=(0, 0), eyes="open", tuck=0, dy=0, zz=0, sparkle=0,
        hang=False, props=None, arm=None, wag=0, tongue=False, face=None):
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
            if arm and i == 3: continue
            x = xs[i] + (2 * i - 3 if hang else 0)
            limb(c, x, by + 2, x + legs[i] // 2, foot - legs[i], FUR_D if i in (1, 2) else FUR)
    # cuerpo y cuello
    c.ell(30, by, 16, 8, LINE); c.ell(30, by, 15, 7, FUR)
    c.line(20, by - 6, 38, by - 6, FUR_L)
    hx, hy = (47, by - 3) if lying else (46 + head[0], by - 12 + head[1])
    if not lying:
        c.ell(43, by - 4, 5, 6, LINE); c.ell(43, by - 4, 4, 5, FUR)
        c.line(hx - 3, hy + 2, 43, by - 2, FUR, 6)
    draw_head(c, hx, hy, eyes, tongue, **(face or {}))
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
def focus(i):  return dog(bob=(0, 0, 1, 1)[i], eyes="focus", head=(1, 1), face=dict(brow="focus", smile="flat"))
def celeb(i):  return dog(dy=-round(10 * abs(math.sin(i / 6 * math.pi))), hang=i in (1, 2, 3, 4), eyes="happy", sparkle=1 + i % 4,
                          wag=(3, -3)[i % 2], tongue=True, face=dict(blush=True, ear="perk"))
def sleep(i):  return dog(bob=(0, 1, 1, 0)[i], eyes="content", tuck=6, zz=1 + i % 3, face=dict(smile="flat", ear="droop"))
def drag(i):   return dog(eyes="wide", hang=True, head=(0, -1 + i), bob=i, wag=-2, face=dict(brow="raise", smile="o", ear="perk"))

# --- ánimos (variantes que la app alterna según estado y música) ---
def read(i):                                                            # concentración: sentada en la silla con el libro en las patas
    c = C()
    bob = (0, 0, 1, 0)[i]
    hx, hy = seated(c, i, bob, desk=False)
    draw_head(c, hx, hy + 1, "down")
    bx, by = hx + 4, hy + 8
    limb(c, 22, 30 + bob, bx + 1, by + 8, FUR_D); limb(c, 23, 31 + bob, bx + 11, by + 8)   # brazos hasta las esquinas
    book(c, bx, by, (0, 0, 2, 1)[i])
    for x, col in ((bx, FUR_D), (bx + 12, FUR)): c.ell(x, by + 7, 2, 1.5, LINE); c.ell(x, by + 7, 1, 1, col)  # patitas
    return c.p
def write(i):                                                           # concentración: sentada al escritorio, escribe con lápiz
    c = C()
    bob = (0, 0, 0, 1)[i]
    hx, hy = seated(c, i, bob)
    c.rect(37, 38, 54, 39, PAPER); c.line(37, 39, 54, 39, PAPER_D)                      # hoja sobre el escritorio
    for k in range(i + 1): c.line(40, 38, 41 + 3 * k, 38, INK)
    draw_head(c, hx + 1, hy + 2, "down", brow="focus", smile="flat")
    limb(c, 22, 30 + bob, 38, 38, FUR_D)                                               # pata que sujeta la hoja
    px = 42 + 3 * i
    limb(c, 23, 31 + bob, px - 1, 36)                                                  # pata con el lápiz
    c.line(px, 37, px + 3, 30, GOLD); c.put(px, 38, INK); c.put(px + 3, 30, (240, 140, 160))
    return c.p
def tea(i):                                                             # pausa: té con vapor, sorbo en el frame 3
    sip = i == 3
    def p(c, by, hx, hy):
        cx, cy = (hx + 9, hy + 3) if sip else (hx + 8, hy + 8)
        c.rect(cx, cy, cx + 5, cy + 5, WHITE); c.rect(cx + 1, cy, cx + 4, cy, TEA); c.rect(cx + 6, cy + 1, cx + 7, cy + 3, WHITE)
        for k in range(3): c.put(cx + 1 + k * 2 + ((i + k) % 2), cy - 2 - k - (i % 2) * 2, STEAM)
    return dog(bob=(0, 1, 1, 0)[i], eyes="happy" if sip else "content", head=(0, -1 if sip else 0), face=dict(blush=sip),
               arm=(lambda hx, hy: (hx + 9, hy + 7)) if sip else (lambda hx, hy: (hx + 8, hy + 12)), props=p)
def upright(c, bob=0, wag=0):                                            # de pie sobre las patas traseras; devuelve el hombro
    c.line(15, 47, 5, 41 + wag, LINE, 4); c.line(15, 47, 5, 41 + wag, FUR, 2)          # cola
    limb(c, 19, 46, 17, 60, FUR_D); limb(c, 23, 46, 26, 60, FUR)                       # patas traseras al suelo
    c.ell(21, 36 + bob, 7, 11, LINE); c.ell(21, 36 + bob, 6, 10, FUR)                  # torso erguido
    c.line(18, 28 + bob, 18, 40 + bob, FUR_L)
    return 24, 31 + bob

def guitar(i):                                                          # música: de pie tocando la guitarra
    c = C()
    bob = (0, 1, 0, 1)[i]
    sx, sy = upright(c, bob, (2, -2)[i % 2])
    draw_head(c, 26, 20 + bob + (0, 1, 0, 1)[i], "shades", tongue=i % 2 == 1, ear="perk")
    gy = 44 + bob
    c.line(31, gy - 3, 48, gy - 22, WOOD_D, 2); c.line(31, gy - 4, 47, gy - 22, WOOD)  # mástil hacia adelante y arriba
    c.rect(46, gy - 27, 50, gy - 23, INK)
    for k in range(3): c.put(51, gy - 27 + k, GOLD)
    c.ell(27, gy, 7, 6, RED_D); c.ell(27, gy, 6, 5, RED); c.ell(28, gy - 1, 2, 2, INK)
    c.line(23, gy + 1, 31, gy - 4, PAPER_D)                                            # cuerdas
    limb(c, sx - 2, sy, 31, 38 + bob, FUR_D); limb(c, 31, 38 + bob, 40, gy - 14 + (0, 1, 0, 1)[i], FUR_D)  # codo y pata en el mástil
    limb(c, sx, sy + 1, 28 + (0, 2, 0, 2)[i], gy + 3 - (0, 3, 0, 3)[i])               # rasguea
    notes(c, i)
    return c.p

def headbang(i):                                                        # música: rockeando, cabezazo y pata con cuernos
    c = C()
    bob = (0, 1, 2, 1)[i]
    sx, sy = upright(c, bob, (3, -3)[i % 2])
    dx, dy = ((0, 0), (2, 3), (5, 7), (2, 3))[i]
    limb(c, sx, sy + 1, 30, 44 + bob)                                                  # pata en la cadera
    hx, hy = 26 + dx, 20 + bob + dy
    c.line(22, 28 + bob, hx - 2, hy + 3, LINE, 8); c.line(22, 28 + bob, hx - 2, hy + 3, FUR, 6)   # cuello que sigue al cabezazo
    draw_head(c, hx, hy, "shades", tongue=i == 2, ear=("perk", "normal", "flip", "normal")[i])
    ux, uy = (14, 12) if i % 2 == 0 else (16, 15)                                      # pata arriba con cuernos
    limb(c, sx - 3, sy - 1, ux, uy, FUR_D)
    c.line(ux - 2, uy - 2, ux - 3, uy - 5, LINE); c.line(ux + 2, uy - 2, ux + 3, uy - 5, LINE)
    if i == 2:                                                                          # líneas de movimiento
        for k in range(3): c.line(hx - 10 + k * 3, hy - 14 + k, hx - 8 + k * 3, hy - 12 + k, INK)
    notes(c, i)
    return c.p
def drums(i):                                                           # música: sentada en un piso tocando la batería
    hit = ("snare", "crash", "snare", "tom")[i]
    c = C()
    bob = (1, 0, 1, 0)[i]
    c.rect(11, 51, 25, 52, WOOD_D); c.rect(12, 50, 24, 50, RED)                       # piso (banqueta)
    c.line(13, 53, 12, 59, WOOD_D, 2); c.line(23, 53, 24, 59, WOOD_D, 2)
    c.line(14, 50, 4, 55 + (i % 2), LINE, 4); c.line(14, 50, 4, 55 + (i % 2), FUR, 2)  # cola en el piso
    c.ell(19, 45, 7, 6, LINE); c.ell(19, 45, 6, 5, FUR_D)                              # muslo sentado
    limb(c, 22, 47, 27, 57, FUR_D)                                                     # pata trasera al pedal
    c.ell(21, 38 + bob, 7, 11, LINE); c.ell(21, 38 + bob, 6, 10, FUR)                  # torso erguido
    c.line(18, 29 + bob, 18, 40 + bob, FUR_L)
    hx, hy = 26, 22 + bob + (1 if hit == "crash" else 0)
    draw_head(c, hx, hy, "shades", tongue=hit == "crash", ear="perk")
    # batería: bombo, caja, tom y platillo
    c.line(56, 58, 56, 26, GREY); c.line(52, 58, 60, 58, GREY)
    cy = 24 + (1 if hit == "crash" else 0)
    c.ell(56, cy, 7, 1.5, WOOD_D); c.ell(56, cy, 6, 1, GOLD)
    c.ell(45, 50, 8, 8, LINE); c.ell(45, 50, 7, 7, RED); c.ell(45, 50, 5, 5, PAPER); c.ell(45, 50, 2, 2, RED_D)
    c.rect(28, 41, 39, 46, LINE); c.rect(29, 42, 38, 45, GREY); c.line(29, 42, 38, 42, PAPER)
    c.line(33, 47, 33, 58, GREY); c.line(30, 58, 36, 58, GREY)
    c.rect(40, 34, 49, 40, LINE); c.rect(41, 35, 48, 39, BLUE); c.line(41, 35, 48, 35, PAPER)
    # patas delanteras con baquetas: (pata, punta) según el golpe
    up_l, up_r = ((31, 30), (25, 22)), ((36, 26), (36, 16))
    snare_l, crash_r, tom_r = ((30, 38), (36, 41)), ((44, 28), (53, 23)), ((38, 32), (45, 34))
    left = snare_l if hit == "snare" else up_l
    right = {"crash": crash_r, "tom": tom_r}.get(hit, up_r)
    for ((px, py), (tx, ty)), col in ((left, FUR_D), (right, FUR)):
        limb(c, 24, 33 + bob, px, py, col)
        c.line(px, py, tx, ty, WOOD, 1); c.put(tx, ty, PAPER)
    spark = {"snare": (37, 39), "crash": (56, 20), "tom": (46, 32)}[hit]
    for dx, dy in ((-3, -2), (0, -3), (3, -2)): c.line(spark[0] + dx // 3, spark[1] + dy // 3, spark[0] + dx, spark[1] + dy, GOLD)
    notes(c, i)
    return c.p
def listen(i):                                                          # concentración + música: audífonos, sigue el ritmo
    return dog(bob=(0, 1, 0, 1)[i], eyes="content", head=(1, (1, 2, 1, 2)[i]), wag=(1, -1)[i % 2], face=dict(blush=True),
               props=lambda c, by, hx, hy: headphones(c, hx, hy))

def seated(c, i, bob, desk=True):                                       # sentada en una silla (y escritorio); devuelve la cabeza
    if desk:
        c.rect(32, 40, 63, 41, WOOD); c.rect(32, 42, 63, 42, WOOD_D)
        c.line(35, 43, 35, 63, WOOD_D, 2); c.line(61, 43, 61, 63, WOOD_D, 2)
    c.rect(8, 47, 24, 48, WOOD_D); c.rect(9, 46, 23, 46, RED)                          # silla
    c.line(10, 49, 10, 63, WOOD_D, 2); c.line(22, 49, 22, 63, WOOD_D, 2); c.line(9, 46, 7, 30, WOOD_D, 2)
    c.line(12, 46, 3, 50 + (i % 2), LINE, 4); c.line(12, 46, 3, 50 + (i % 2), FUR, 2)  # cola
    c.ell(18, 42, 7, 5, LINE); c.ell(18, 42, 6, 4, FUR_D)                              # muslo sentado
    limb(c, 22, 44, 27, 60, FUR_D)                                                     # pata trasera al suelo
    c.ell(20, 35 + bob, 7, 11, LINE); c.ell(20, 35 + bob, 6, 10, FUR)                  # torso erguido
    c.line(17, 26 + bob, 17, 38 + bob, FUR_L)
    return 25, 19 + bob

def laptop(i):                                                          # Claude trabajando: sentada al escritorio, gafas, teclea
    c = C()
    bob = (0, 1, 0, 1)[i]
    hx, hy = seated(c, i, bob)
    c.line(hx - 3, hy - 2, hx - 5, hy - 3, GREY)                                       # patilla de las gafas
    draw_head(c, hx, hy, "down", brow="focus", smile="flat")
    ex, ey = hx + 3, hy - 1                                                            # gafas redondas con reflejo de pantalla
    c.line(ex - 3, ey - 2, ex + 3, ey - 2, GREY); c.line(ex - 3, ey + 2, ex + 3, ey + 2, GREY)
    c.line(ex - 3, ey - 2, ex - 3, ey + 2, GREY); c.line(ex + 3, ey - 2, ex + 3, ey + 2, GREY)
    c.line(ex - 3, ey - 1, hx - 3, hy - 2, GREY)
    c.put(ex + 2, ey - 1 + i % 3, (150, 210, 255))
    # laptop: base con teclado y tapa abierta (se ve el dorso con una huellita), luz de pantalla hacia ella
    c.rect(34, 38, 52, 39, LINE); c.rect(35, 38, 51, 38, GREY)
    c.poly([(47, 38), (52, 38), (57, 22), (52, 22)], GREY)
    c.ell(52, 30, 1.5, 1.5, PAPER_D); c.put(50, 28, PAPER_D); c.put(52, 27, PAPER_D); c.put(54, 28, PAPER_D)
    for y in range(24, 38, 2): c.put(48 + (38 - y) // 4 - 1 - (y // 2 + i) % 2, y, (110, 170, 230))
    # patas delanteras tecleando por turnos
    keys = ((38, 37), (42, 36), (40, 36), (44, 37))
    l, r = keys[i], keys[(i + 2) % 4]
    for (kx, ky), col, up in (((l[0], l[1]), FUR_D, i % 2), ((r[0] + 2, r[1]), FUR, 1 - i % 2)):
        limb(c, 23, 30 + bob, kx, ky - up * 2, col)
    for k in range(i % 4): c.rect(30 + k * 3, 6, 31 + k * 3, 7, INK)                   # puntitos de "pensando"
    return c.p

GREEN, SWEAT = (80, 190, 100), (140, 200, 250)
def mission(i):                                                         # misión cumplida: alza una bandera con ✓ y festeja
    def p(c, by, hx, hy):
        c.line(58, 58, 58, 1, WOOD_D, 2)                                                # asta
        for x in range(44, 58):                                                         # bandera que flamea hacia atrás
            dy = round(math.sin((x + i * 3) / 2.5))
            c.line(x, 2 + dy, x, 11 + dy, GREEN)
        ck = lambda x, y: round(math.sin((x + i * 3) / 2.5))
        for (x0, y0), (x1, y1) in (((48, 6), (50, 8)), ((50, 8), (54, 4))):            # ✓ que flamea con la tela
            for t in range(5):
                x, y = x0 + (x1 - x0) * t / 4, y0 + (y1 - y0) * t / 4
                c.put(x, y + ck(round(x), y), WHITE)
        for k in range(1 + i % 3):                                                      # confeti
            cx, cy = [(12, 10), (30, 8), (20, 18)][k]
            c.rect(cx, cy + i, cx + 1, cy + i + 1, PATCH[(i + k) % len(PATCH)])
    return dog(dy=(0, -3, -5, -3)[i], eyes="happy", tongue=True, wag=(3, -3)[i % 2], sparkle=2, face=dict(blush=True, ear="perk"),
               arm=(57, 30), props=p)
def oops(i):                                                            # falló: orejas gachas, gotita de sudor y nubecita
    def p(c, by, hx, hy):
        sy = hy - 7 + i                                                                 # gota de sudor que resbala
        c.ell(hx + 6, sy + 1, 1.5, 2, LINE); c.ell(hx + 6, sy + 1, 1, 1.5, SWEAT); c.put(hx + 6, sy - 1, SWEAT)
        cx, cy = hx - 2, 8                                                              # nube de tormenta
        for dx, dy, r in ((0, 1, 4), (5, -1, 5), (10, 1, 4)): c.ell(cx + dx, cy + dy, r + 1, 3.5, LINE)
        for dx, dy, r in ((0, 1, 4), (5, -1, 5), (10, 1, 4)): c.ell(cx + dx, cy + dy, r, 2.5, (96, 102, 116))
        for k in range(3): c.put(cx + k * 5, cy + 6 + (i + k) % 3 * 2, SWEAT)          # lluvia
        if i % 2: c.line(cx + 6, cy + 4, cx + 4, cy + 7, GOLD); c.line(cx + 4, cy + 7, cx + 6, cy + 7, GOLD); c.line(cx + 6, cy + 7, cx + 4, cy + 10, GOLD)
    return dog(bob=(1, 1, 2, 1)[i], eyes="sad", head=(-1, 5), wag=0, props=p, face=dict(brow="sad", smile="wobble", ear="droop"))
def ask(i):                                                             # espera tu ok: ladea la cabeza, pata arriba y "?"
    def p(c, by, hx, hy):
        bx, by2 = hx - 2, hy - 22
        c.ell(bx + 3, by2 + 4, 6, 6, LINE); c.ell(bx + 3, by2 + 4, 5, 5, WHITE)          # globito
        c.put(bx - 1, by2 + 10, WHITE); c.put(bx - 2, by2 + 11, LINE)
        c.line(bx + 1, by2 + 2, bx + 3, by2 + 1, ACC); c.line(bx + 3, by2 + 1, bx + 5, by2 + 2, ACC)
        c.line(bx + 5, by2 + 2, bx + 4, by2 + 4, ACC); c.line(bx + 4, by2 + 4, bx + 3, by2 + 5, ACC)
        c.put(bx + 3, by2 + 7, ACC)
    return dog(bob=(0, 0, 1, 0)[i], eyes="wide" if i == 2 else "open", head=(1, (0, -1, -1, 0)[i]), wag=(2, -2)[i % 2], face=dict(brow="quirk", ear="perk"),
               arm=(52, (36, 34, 34, 36)[i]), props=p)
ACC = (232, 82, 60)

def balloon(c, bx, by):                                                 # globito blanco con colita abajo a la izquierda
    c.ell(bx + 3, by + 4, 6, 6, LINE); c.ell(bx + 3, by + 4, 5, 5, WHITE)
    c.put(bx - 1, by + 10, WHITE); c.put(bx - 2, by + 11, LINE)

def growl(i):                                                           # vio el teléfono: agachada, pelo erizado, colmillos y "grrr"
    shake = (0, 1, 0, -1)[i]
    def p(c, by, hx, hy):
        for x in range(20, 38, 4): c.line(x, by - 7, x + 1, by - 10 - (x + i) % 2, LINE)   # lomo erizado
        for k in range(2):                                                              # rumor del gruñido (zigzag)
            gx, gy = hx + 14, hy + 1 + k * 4 + i % 2
            for j in range(5): c.put(gx + j, gy - j % 2, INK)
        bx, by2 = hx - 17, hy - 20                                                      # globito con el teléfono vibrando
        balloon(c, bx, by2)
        c.rect(bx + 1, by2 + 1, bx + 5, by2 + 8, INK); c.rect(bx + 2, by2 + 2, bx + 4, by2 + 6, (110, 170, 230)); c.put(bx + 3, by2 + 7, GREY)
        if i % 2: c.line(bx - 1, by2 + 2, bx - 1, by2 + 4, ACC); c.line(bx + 7, by2 + 5, bx + 7, by2 + 7, ACC)
    return dog(bob=1, head=(-1 + shake, 6), eyes="focus", wag=-4, props=p,
               face=dict(brow="focus", smile="snarl", ear="droop"))

def bark(i):                                                            # distracción que cuenta: ladra con todo, saltito y "!"
    loud = i in (1, 3)
    def p(c, by, hx, hy):
        if not loud: return
        mx, my = hx + 13, hy + 5                                                        # ondas del ladrido desde el hocico
        for dx, dy in ((3, -5), (4, 0), (3, 5)):
            c.line(mx + dx // 3, my + dy // 3, mx + dx, my + dy, ACC if i == 3 else GOLD)
        ex = hx + 8                                                                     # "!" sobre el hocico
        c.rect(ex - 1, hy - 19, ex + 1, hy - 13, ACC); c.rect(ex - 1, hy - 11, ex + 1, hy - 10, ACC)
    return dog(dy=(0, -3, 0, -2)[i], legs=(0, 0, 3, 3) if loud else (0, 0, 0, 0), head=(0, -2 if loud else 0), eyes="focus",
               wag=(4, -4)[i % 2], props=p, face=dict(brow="focus", smile="bark" if loud else "flat", ear="perk"))

def away(i):                                                            # foco pausado porque te fuiste: echada, te espera con "⏸ ..."
    def p(c, by, hx, hy):
        bx, by2 = hx - 4, hy - 21
        balloon(c, bx, by2)
        c.rect(bx + 1, by2 + 2, bx + 2, by2 + 6, INK); c.rect(bx + 4, by2 + 2, bx + 5, by2 + 6, INK)
        for k in range(i % 4): c.put(bx + 11 + k * 3, by2 + 8, INK)                    # puntitos que se van sumando
    return dog(bob=(0, 0, 1, 0)[i], eyes="closed" if i == 3 else "half", tuck=6, props=p, face=dict(smile="flat", ear="droop"))

def png(path, w, h, rows):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rows)
    def ch(t, d): c = struct.pack(">I", len(d)) + t + d; return c + struct.pack(">I", zlib.crc32(t + d))
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw, 9)) + ch(b"IEND", b""))

def sheet(fn, n):
    frames = [fn(i) for i in range(n)]
    return [sum((frames[k][y] for k in range(n)), []) for y in range(F)]

anims = {"idle": (idle, 4), "walk": (walk, 6), "focus": (focus, 4), "celebrate": (celeb, 6), "sleep": (sleep, 4), "dragged": (drag, 2),
         "read": (read, 4), "write": (write, 4), "tea": (tea, 4), "guitar": (guitar, 4), "headbang": (headbang, 4), "drums": (drums, 4), "listen": (listen, 4), "work": (laptop, 4),
         "mission": (mission, 4), "oops": (oops, 4), "ask": (ask, 4),
         "growl": (growl, 4), "bark": (bark, 4), "away": (away, 4)}
for name, (fn, n) in anims.items(): png(f"{OUT}/{name}.png", F * n, F, sheet(fn, n))

# vista previa ampliada x3 con todas las filas (fondo claro)
rows = []
maxn = 6
for name, (fn, n) in anims.items():
    sh = sheet(fn, n)
    for y in range(F): rows.append(sh[y] + [(235, 235, 240, 255)] * (F * (maxn - n)))
big = [[px for px in r for _ in range(3)] for r in rows for _ in range(3)]
png(sys.argv[2], F * maxn * 3, len(rows) * 3, [[(235,235,240,255) if p[3]==0 else p for p in r] for r in big])
