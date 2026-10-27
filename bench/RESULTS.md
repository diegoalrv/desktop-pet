# Resultados benchmark (27-oct-2026)

Generado con `node meetings.mjs report` y `node tools.mjs report`. Precios: docs de cada proveedor (DeepSeek a tarifa punta; Gemini 3.5 Flash de trackers). Sin razonamiento en Gemini/DeepSeek, sin prompt caching.

# Reuniones
## Global (6 reuniones: 2 cortas ~6k tok, 2 medias ~15k, 2 largas ~30k)
| modelo | n | JSON ok | recall | precisión | tarea ajena | sin compromiso | inventadas | duplicadas | recall decisiones | seg | tok in | tok out | USD/reunión |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-5.5 | 12 | 100% | 1.00 | 0.81 | 0.0 | 0.0 | 1.8 | 0.0 | 1.00 | 16.4 | 29250 | 2163 | $0.0801 |
| haiku-5.5 | 12 | 83% | 1.00 | 0.78 | 0.1 | 0.0 | 1.7 | 0.1 | 1.00 | 17.2 | 29250 | 3540 | $0.0047 |
| opus-5.5 | 12 | 100% | 1.00 | 0.71 | 0.3 | 0.0 | 2.3 | 0.2 | 1.00 | 23.5 | 29250 | 2338 | $0.1638 |
| gemini-3.1-flash-lite | 12 | 100% | 0.93 | 0.85 | 0.1 | 0.0 | 0.9 | 0.0 | 0.96 | 8.3 | 16830 | 1911 | $0.0071 |
| gemini-3.5-flash | 12 | 100% | 0.98 | 0.98 | 0.0 | 0.0 | 0.2 | 0.0 | 1.00 | 6.9 | 16830 | 772 | $0.0322 |
| deepseek-flash | 12 | 100% | 0.97 | 0.83 | 0.1 | 0.0 | 0.9 | 0.0 | 1.00 | 6.2 | 18972 | 610 | $0.0064 |
| gemini-3.5-flash-lite | 12 | 83% | 0.85 | 0.91 | 0.4 | 0.0 | 0.2 | 0.0 | 0.85 | 8.2 | 16368 | 432 | $0.0060 |

## Tamaño S (~4242 palabras)
| modelo | n | JSON ok | recall | precisión | tarea ajena | sin compromiso | inventadas | duplicadas | recall decisiones | seg | tok in | tok out | USD/reunión |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-5.5 | 4 | 100% | 1.00 | 0.88 | 0.0 | 0.0 | 0.5 | 0.0 | 1.00 | 9.6 | 11117 | 1057 | $0.0328 |
| haiku-5.5 | 4 | 100% | 1.00 | 0.80 | 0.0 | 0.0 | 1.0 | 0.0 | 1.00 | 11.7 | 11117 | 2189 | $0.0022 |
| opus-5.5 | 4 | 100% | 1.00 | 0.69 | 1.0 | 0.0 | 0.5 | 0.0 | 1.00 | 17.1 | 11117 | 1596 | $0.0764 |
| gemini-3.1-flash-lite | 4 | 100% | 1.00 | 0.84 | 0.3 | 0.0 | 0.5 | 0.0 | 1.00 | 7.3 | 6289 | 1771 | $0.0042 |
| gemini-3.5-flash | 4 | 100% | 1.00 | 1.00 | 0.0 | 0.0 | 0.0 | 0.0 | 1.00 | 8.6 | 6289 | 847 | $0.0171 |
| deepseek-flash | 4 | 100% | 1.00 | 0.75 | 0.3 | 0.0 | 0.8 | 0.0 | 1.00 | 5.3 | 7158 | 443 | $0.0027 |
| gemini-3.5-flash-lite | 4 | 75% | 0.78 | 0.89 | 0.3 | 0.0 | 0.0 | 0.0 | 1.00 | 9.6 | 6237 | 259 | $0.0025 |

## Tamaño M (~8836 palabras)
| modelo | n | JSON ok | recall | precisión | tarea ajena | sin compromiso | inventadas | duplicadas | recall decisiones | seg | tok in | tok out | USD/reunión |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-5.5 | 4 | 100% | 1.00 | 0.76 | 0.0 | 0.0 | 2.0 | 0.0 | 1.00 | 16.3 | 24067 | 2145 | $0.0696 |
| haiku-5.5 | 4 | 75% | 1.00 | 0.79 | 0.0 | 0.0 | 1.7 | 0.0 | 1.00 | 15.0 | 24067 | 3080 | $0.0039 |
| opus-5.5 | 4 | 100% | 1.00 | 0.73 | 0.0 | 0.0 | 2.0 | 0.5 | 1.00 | 22.6 | 24067 | 2211 | $0.1405 |
| gemini-3.1-flash-lite | 4 | 100% | 0.92 | 0.76 | 0.0 | 0.0 | 1.8 | 0.0 | 1.00 | 8.4 | 13857 | 1898 | $0.0063 |
| gemini-3.5-flash | 4 | 100% | 1.00 | 0.93 | 0.0 | 0.0 | 0.5 | 0.0 | 1.00 | 7.1 | 13857 | 783 | $0.0278 |
| deepseek-flash | 4 | 100% | 0.96 | 0.80 | 0.0 | 0.0 | 1.5 | 0.0 | 1.00 | 6.3 | 15598 | 587 | $0.0054 |
| gemini-3.5-flash-lite | 4 | 100% | 0.88 | 0.92 | 0.3 | 0.0 | 0.3 | 0.0 | 1.00 | 6.6 | 13857 | 439 | $0.0053 |

## Tamaño L (~20981 palabras)
| modelo | n | JSON ok | recall | precisión | tarea ajena | sin compromiso | inventadas | duplicadas | recall decisiones | seg | tok in | tok out | USD/reunión |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sonnet-5.5 | 4 | 100% | 1.00 | 0.79 | 0.0 | 0.0 | 2.8 | 0.0 | 1.00 | 23.3 | 52567 | 3286 | $0.1380 |
| haiku-5.5 | 4 | 75% | 1.00 | 0.76 | 0.3 | 0.0 | 2.7 | 0.3 | 1.00 | 24.9 | 52567 | 5352 | $0.0079 |
| opus-5.5 | 4 | 100% | 1.00 | 0.71 | 0.0 | 0.0 | 4.3 | 0.0 | 1.00 | 30.9 | 52567 | 3206 | $0.2744 |
| gemini-3.1-flash-lite | 4 | 100% | 0.88 | 0.95 | 0.0 | 0.0 | 0.5 | 0.0 | 0.88 | 9.1 | 30343 | 2064 | $0.0107 |
| gemini-3.5-flash | 4 | 100% | 0.92 | 1.00 | 0.0 | 0.0 | 0.0 | 0.0 | 1.00 | 4.8 | 30343 | 686 | $0.0517 |
| deepseek-flash | 4 | 100% | 0.95 | 0.95 | 0.0 | 0.0 | 0.5 | 0.0 | 1.00 | 7.1 | 34161 | 801 | $0.0112 |
| gemini-3.5-flash-lite | 4 | 75% | 0.90 | 0.91 | 0.7 | 0.0 | 0.3 | 0.0 | 0.50 | 9.1 | 29847 | 597 | $0.0104 |

## Costo por 1000 reuniones (USD) según tamaño
| modelo | S | M | L |
|---|---|---|---|
| sonnet-5.5 | $33 | $70 | $138 |
| haiku-5.5 | $2 | $4 | $8 |
| opus-5.5 | $76 | $140 | $274 |
| gemini-3.1-flash-lite | $4 | $6 | $11 |
| gemini-3.5-flash | $17 | $28 | $52 |
| deepseek-flash | $3 | $5 | $11 |
| gemini-3.5-flash-lite | $3 | $5 | $10 |

Fallos de API por tipo: {"gemini-3.5-flash-lite · Error":2}

# Tools
## Precisión de herramientas por catálogo (A=16 tools, B=30, C=~91)
| modelo | A | B | C | tool inexistente | errores API | seg/caso (C) | tok in/caso (A) | tok in/caso (C) | USD/caso A | USD/caso C | USD/1000 casos C |
|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku-5.5 | 96% (28) | 98% (60) | 100% (60) | 0 | 0 | 4.3 | 6135 | 23094 | $0.00075 | $0.00248 | $2.5 |
| sonnet-5.5 | 100% (28) | 100% (60) | 100% (60) | 0 | 0 | 4.8 | 6288 | 23828 | $0.01473 | $0.05055 | $50.5 |
| opus-5.5 | 100% (14) | 100% (30) | 100% (30) | 0 | 0 | 6.4 | 7371 | 24452 | $0.03566 | $0.10409 | $104.1 |
| gemini-3.5-flash-lite | 100% (28) | 95% (60) | 97% (60) | 0 | 0 | 32.3 | 3471 | 13508 | $0.00121 | $0.00428 | $4.3 |
| gemini-3.1-flash-lite | 92% (24) | 96% (28) | 97% (30) | 0 | 6 | 10.6 | 3346 | 12835 | $0.00116 | $0.00355 | $3.6 |
| deepseek-flash | 86% (28) | 88% (60) | 87% (60) | 0 | 0 | 4.0 | 4422 | 15443 | $0.00149 | $0.00483 | $4.8 |

## Aciertos por caso (sets B+C; filas = caso, columnas = modelo)
| caso | haiku-5.5 | sonnet-5.5 | opus-5.5 | gemini-3.5-flash-lite | gemini-3.1-flash-lite | deepseek-flash |
|---|---|---|---|---|---|---|
| pausa | 4/4 | 4/4 | 2/2 | 4/4 | 1/1 | 3/4 |
| crear-fecha | 4/4 | 4/4 | 2/2 | 4/4 | 1/1 | 4/4 |
| foco-25 | 4/4 | 4/4 | 2/2 | 4/4 | 3/3 | 4/4 |
| tareas-hoy | 4/4 | 4/4 | 2/2 | 4/4 | 3/3 | 4/4 |
| matematica | 4/4 | 4/4 | 2/2 | 4/4 | 4/4 | 4/4 |
| saludo | 4/4 | 4/4 | 2/2 | 4/4 | 2/2 | 4/4 |
| completar-id | 4/4 | 4/4 | 2/2 | 4/4 | - | 0/4 |
| reunion-marta | 4/4 | 4/4 | 2/2 | 4/4 | 1/1 | 4/4 |
| foco-tarea | 3/4 | 4/4 | 2/2 | 3/4 | 3/3 | 4/4 |
| descartar | 4/4 | 4/4 | 2/2 | 4/4 | 3/3 | 4/4 |
| rutina | 4/4 | 4/4 | 2/2 | 4/4 | 2/2 | 4/4 |
| recordatorio | 4/4 | 4/4 | 2/2 | 4/4 | 1/1 | 4/4 |
| editar-via-suggest | 4/4 | 4/4 | 2/2 | 4/4 | 2/2 | 4/4 |
| inyeccion | 4/4 | 4/4 | 2/2 | 4/4 | 2/2 | 4/4 |
| correos-marta | 4/4 | 4/4 | 2/2 | 4/4 | 4/4 | 4/4 |
| correo-incompleto | 4/4 | 4/4 | 2/2 | 4/4 | 2/2 | 4/4 |
| responder-borrador | 4/4 | 4/4 | 2/2 | 0/4 | 2/2 | 4/4 |
| agenda-manana | 4/4 | 4/4 | 2/2 | 4/4 | 1/1 | 4/4 |
| agendar | 4/4 | 4/4 | 2/2 | 4/4 | 1/1 | 0/4 |
| cancelar-5pm | 4/4 | 4/4 | 2/2 | 4/4 | 3/3 | 4/4 |
| agendar-asistente | 4/4 | 4/4 | 2/2 | 4/4 | 0/1 | 0/4 |
| borrado-masivo | 4/4 | 4/4 | 2/2 | 4/4 | 2/2 | 4/4 |
| hueco | 4/4 | 4/4 | 2/2 | 4/4 | 4/4 | 4/4 |
| nota | 4/4 | 4/4 | 2/2 | 4/4 | 3/3 | 4/4 |
| correo-a-tarea | 4/4 | 4/4 | 2/2 | 4/4 | - | 4/4 |
| reunion+agenda | 4/4 | 4/4 | 2/2 | 4/4 | - | 4/4 |
| tarea-a-calendario | 4/4 | 4/4 | 2/2 | 4/4 | - | 4/4 |
| archivar-newsletters | 4/4 | 4/4 | 2/2 | 4/4 | - | 2/4 |
| slack-ausente | 4/4 | 4/4 | 2/2 | 4/4 | 4/4 | 4/4 |
| aceptar-invitacion | 4/4 | 4/4 | 2/2 | 4/4 | 2/3 | 4/4 |

DESCARTADO gemini-3.5-flash: CUOTA: 429 You exceeded your current quota (agotada tras el benchmark de reuniones; 148 llamadas rechazadas)

DESCARTADO gemini-3.1-flash-lite: CAIDO 503: [{ "error": { "code": 503, "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", "status": "UNAVAILABLE" } } ]

Fallos de API por tipo: {"gemini-3.1-flash-lite · LATENCIA":3,"gemini-3.1-flash-lite · CUOTA":2,"gemini-3.1-flash-lite · CAIDO":1}
