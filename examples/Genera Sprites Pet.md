# Genera los sprites de mi mascota

Te adjunto fotos de mi mascota. Quiero convertirla en una mascota de escritorio animada en pixel art. Entrégame **un solo archivo `.zip`** listo para importar en la app, con el formato exacto que describo abajo. Si puedes ejecutar código (Python), úsalo para recortar, escalar y armar las tiras y el zip.

## 1. Antes de empezar

Mira las fotos y escribe una **ficha del personaje** de 3 a 5 líneas: especie, raza aproximada, color y patrón del pelaje, color de ojos, rasgos distintivos (orejas, manchas, cola, collar o pañoleta). Usa esa misma ficha para **todas** las animaciones: la mascota tiene que verse idéntica en cada una.

Si no sabes su nombre o especie, pregúntamelo antes de generar.

## 2. Estilo (igual en todas las imágenes)

- Pixel art tierno estilo videojuego retro, contorno oscuro de 1 px, colores planos con una sombra.
- Cuerpo entero, **vista lateral mirando hacia la derecha** (la app la voltea cuando camina a la izquierda).
- **Fondo 100 % transparente** (PNG con canal alfa). Nada de suelo, sombras de piso ni escenario.
- Cada cuadro mide **128 × 128 px**. La mascota ocupa ~80 % del alto, centrada, con **las patas apoyadas siempre en la misma línea** cerca del borde inferior y al mismo tamaño en todos los cuadros (si no, salta al cambiar de animación).
- Los accesorios (libro, taza, guitarra…) en el mismo estilo y escala.

## 3. Formato de cada animación

Cada animación es **una tira horizontal**: N cuadros de 128 × 128 uno al lado del otro, sin separación. Una tira de 4 cuadros mide 512 × 128 px. Nombre del archivo = nombre de la animación (`idle.png`, `walk.png`…). Los cuadros forman un ciclo: el último debe enlazar con el primero.

### Obligatorias

| Archivo | Cuadros | Qué hace |
|---|---|---|
| `idle.png` | 4 | Sentada o parada tranquila: respira, parpadea en el cuadro 3, mueve un poco la cola. |
| `walk.png` | 6 | Caminando hacia la derecha, ciclo de patas completo, cabeza que sube y baja un poco. |
| `sleep.png` | 4 | Durmiendo enroscada, ojos cerrados, respira; una "z" pequeña que sube. |
| `celebrate.png` | 6 | Salta de alegría con las patas arriba, ojos felices (^ ^). No se repite: termina aterrizando. |
| `focus.png` | 4 | Concentrada, mirada decidida al frente, cola quieta; acompaña mientras trabajo. |
| `dragged.png` | 2 | La levantaron con el mouse: colgando, patas sueltas, cara de sorpresa. |

### Recomendadas (si alguna falta, la app usa otra parecida)

| Archivo | Cuadros | Qué hace |
|---|---|---|
| `bark.png` | 4 | Llama mi atención fuerte (ladra / maúlla / chilla según la especie), boca abierta, cuerpo hacia adelante. |
| `growl.png` | 4 | Molesta y de advertencia: gruñe o bufa, orejas atrás, pelo erizado, vibra un poco. |
| `away.png` | 4 | Esperando a que vuelva: echada, aburrida, mira hacia un lado, ojos a media asta. |
| `oops.png` | 4 | Algo salió mal: orejas caídas, ojos tristes, un sudor o lágrima. |
| `ask.png` | 4 | Tiene una pregunta: cabeza ladeada, un "?" sobre la cabeza que parpadea. |
| `mission.png` | 4 | Misión cumplida: orgullosa, sostiene una banderita o trofeo, pecho inflado. |
| `work.png` | 4 | Trabajando en un laptop pequeño, tecleando rápido. |
| `read.png` | 4 | Leyendo un libro abierto, pasa la página en el cuadro 4. |
| `write.png` | 4 | Escribiendo con un lápiz en una hoja. |
| `tea.png` | 4 | En pausa: toma de una taza humeante, ojos cerrados de gusto. |
| `listen.png` | 4 | Escucha música con audífonos, se mece suave. |
| `guitar.png` | 4 | Toca una guitarra pequeña. |
| `drums.png` | 4 | Toca una batería pequeña con baquetas. |
| `headbang.png` | 4 | Mueve la cabeza al ritmo de la música, rockera. |

## 4. `manifest.json`

En la raíz del zip, junto a las imágenes. Incluye solo las animaciones que generaste. Reemplaza lo que está entre `<>`:

```json
{
  "id": "<nombre-en-minusculas-sin-espacios>",
  "name": "<Nombre de la mascota>",
  "frameWidth": 128,
  "frameHeight": 128,
  "scale": 1,
  "walkSpeed": 30,
  "groundOffset": 0,
  "character": "<la ficha del personaje del paso 1>",
  "voice": { "bark": "<onomatopeya fuerte, ej. ¡GUAU GUAU! o ¡MIAU!>", "growl": "<advertencia, ej. GRRRR o FFFSSS>" },
  "animations": {
    "idle":      { "file": "idle.png",      "frames": 4, "fps": 4,  "loop": true,  "prompt": "<lo que dibujaste>" },
    "walk":      { "file": "walk.png",      "frames": 6, "fps": 8,  "loop": true },
    "sleep":     { "file": "sleep.png",     "frames": 4, "fps": 2,  "loop": true },
    "celebrate": { "file": "celebrate.png", "frames": 6, "fps": 10, "loop": false },
    "focus":     { "file": "focus.png",     "frames": 4, "fps": 3,  "loop": true },
    "dragged":   { "file": "dragged.png",   "frames": 2, "fps": 5,  "loop": true },
    "bark":      { "file": "bark.png",      "frames": 4, "fps": 6,  "loop": true },
    "growl":     { "file": "growl.png",     "frames": 4, "fps": 8,  "loop": true },
    "away":      { "file": "away.png",      "frames": 4, "fps": 2,  "loop": true },
    "oops":      { "file": "oops.png",      "frames": 4, "fps": 3,  "loop": true },
    "ask":       { "file": "ask.png",       "frames": 4, "fps": 4,  "loop": true },
    "mission":   { "file": "mission.png",   "frames": 4, "fps": 6,  "loop": true },
    "work":      { "file": "work.png",      "frames": 4, "fps": 6,  "loop": true },
    "read":      { "file": "read.png",      "frames": 4, "fps": 2,  "loop": true },
    "write":     { "file": "write.png",     "frames": 4, "fps": 3,  "loop": true },
    "tea":       { "file": "tea.png",       "frames": 4, "fps": 2,  "loop": true },
    "listen":    { "file": "listen.png",    "frames": 4, "fps": 4,  "loop": true },
    "guitar":    { "file": "guitar.png",    "frames": 4, "fps": 6,  "loop": true },
    "drums":     { "file": "drums.png",     "frames": 4, "fps": 6,  "loop": true },
    "headbang":  { "file": "headbang.png",  "frames": 4, "fps": 8,  "loop": true }
  }
}
```

Reglas: `id` solo con minúsculas, números y guiones; nombres de archivo sin espacios ni carpetas; `idle` siempre presente; el número de `frames` tiene que coincidir con los cuadros reales de cada tira.

## 5. Revisión antes de entregar

1. Cada tira mide exactamente (cuadros × 128) × 128 px y tiene fondo transparente.
2. La mascota tiene el mismo tamaño, colores y línea de patas en todas las tiras.
3. Todas miran hacia la derecha.
4. El `manifest.json` es JSON válido y cada `file` existe en el zip.

Entrega el `.zip` para descargar y, aparte, una imagen de vista previa con un cuadro de cada animación.

---

**Sonidos (no los generes):** los cargo yo después en la app (Ajustes → Personaliza tu mascota → Llamados de atención).
