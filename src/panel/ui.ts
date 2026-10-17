export const T = {
  bg: "#16161d",
  card: "rgba(255,255,255,.06)",
  line: "rgba(255,255,255,.10)",
  text: "#ececf1",
  dim: "#8b8b99",
  accent: "#e8523c",
} as const;

export const btn = {
  padding: "0.55em 0.85em", // em: escala con la fuente del panel
  borderRadius: 10,
  border: `1px solid ${T.line}`,
  background: T.card,
  color: T.text,
  cursor: "pointer",
  font: "inherit",
  transition: "background .15s, transform .1s",
} as const;

// Estilos globales de panel/ajustes/gestor: scroll (index.html lo apaga para la mascota), hover/active, foco, sliders.
export const PANEL_CSS = `
  html,body{overflow-y:auto}
  body{background:${T.bg}}
  button:not(:disabled):hover{filter:brightness(1.25)}
  button:not(:disabled):active{transform:scale(.96)}
  button:disabled{opacity:.45;cursor:default}
  input,select,button{color-scheme:dark}
  input:focus,select:focus,button:focus-visible{outline:2px solid ${T.accent};outline-offset:1px}
  input::placeholder{color:${T.dim}}
  input[type=range]{accent-color:${T.accent}}
  ::-webkit-scrollbar{width:8px}
  ::-webkit-scrollbar-thumb{background:${T.line};border-radius:4px}
`;

/** Sistema visual del panel (todo bajo `.pn`, así no toca a la mascota ni a otras ventanas).
 *  Tamaños en em sobre una fuente que escala con el ancho de la ventana. */
export const PN_CSS = `
  html,body{margin:0;overflow:hidden}
  body{background:#13131a}
  .pn{
    --bg:#13131a; --surface:#1b1b24; --surface-2:#252531; --hover:#2d2d3b;
    --line:rgba(255,255,255,.07); --line-2:rgba(255,255,255,.12);
    --text:#ececf1; --muted:#8d8d9c; --accent:${T.accent}; --accent-soft:rgba(232,82,60,.16);
    --r:14px; --r-sm:10px;
    font:clamp(12px,3.9vw,15px)/1.4 system-ui,-apple-system,sans-serif; color:var(--text);
    background:radial-gradient(120% 60% at 100% 0%,rgba(232,82,60,.07),transparent 60%),var(--bg);
    height:100vh; display:grid; grid-template-rows:auto minmax(0,1fr) auto; grid-template-columns:minmax(0,1fr);
    -webkit-font-smoothing:antialiased;
  }
  .pn *{box-sizing:border-box}
  .pn button,.pn input,.pn select{font:inherit;color:inherit;color-scheme:dark}

  /* Estructura: encabezado, contenido con scroll, navegación abajo */
  .pn-head{display:flex;align-items:center;gap:.7em;padding:.85em 1em .55em}
  .pn-avatar{width:2.6em;height:2.6em;flex:none;border-radius:50%;background-color:var(--surface-2);
    box-shadow:inset 0 0 0 1px var(--line-2);background-repeat:no-repeat;image-rendering:pixelated}
  .pn-title{font-weight:650;letter-spacing:-.01em}
  .pn-sub{font-size:.8em;color:var(--muted);display:flex;align-items:center;gap:.35em}
  .pn-body{overflow-y:auto;overflow-x:hidden;padding:.5em 1em 1.1em;display:grid;gap:.9em;align-content:start;grid-template-columns:minmax(0,1fr)}
  .pn-nav{display:flex;gap:.2em;padding:.4em .5em .5em;border-top:1px solid var(--line);background:rgba(19,19,26,.85);backdrop-filter:blur(10px)}
  .pn-tab{flex:1 1 0;min-width:0;display:grid;justify-items:center;gap:.25em;padding:.5em .1em .4em;border:0;border-radius:var(--r-sm);
    background:none;color:var(--muted);font-size:.7em;font-weight:500;cursor:pointer;transition:color .15s,background .15s}
  .pn-tab svg{width:1.75em;height:1.75em}
  .pn-tab:hover{color:var(--text);background:var(--surface)}
  .pn-tab[aria-current=page]{color:var(--accent)}
  .pn-tab[aria-current=page] .pn-tab-ico{background:var(--accent-soft)}
  .pn-tab-ico{display:grid;place-items:center;padding:.2em .9em;border-radius:999px;transition:background .15s}
  .pn-tab span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* Piezas */
  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:.9em}
  .label{font-size:.7em;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:650}
  .stack{display:grid;gap:.6em;grid-template-columns:minmax(0,1fr)}
  .row{display:flex;gap:.5em;align-items:center;min-width:0}
  .grow{flex:1 1 auto;min-width:0}
  .muted{color:var(--muted)}
  .small{font-size:.82em}
  .ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .center{text-align:center;justify-items:center}

  .b{display:inline-flex;align-items:center;justify-content:center;gap:.45em;padding:.6em .9em;border-radius:var(--r-sm);
    border:1px solid var(--line-2);background:var(--surface-2);font-weight:500;cursor:pointer;white-space:nowrap;
    transition:background .15s,border-color .15s,transform .1s,filter .15s,color .15s}
  .b:hover:not(:disabled){background:var(--hover)}
  .b:active:not(:disabled){transform:scale(.97)}
  .b:disabled{opacity:.4;cursor:default}
  .b-primary{background:var(--accent);border-color:transparent;color:#fff;font-weight:600;box-shadow:0 4px 16px -6px var(--accent)}
  .b-primary:hover:not(:disabled){background:var(--accent);filter:brightness(1.1)}
  .b-ghost{background:none;border-color:transparent;color:var(--muted)}
  .b-ghost:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
  .b-sq{padding:.5em;aspect-ratio:1}
  .b-round{border-radius:50%;padding:.75em;aspect-ratio:1}
  .b-block{width:100%}
  .b-sm{padding:.35em .65em;font-size:.85em}

  .field{width:100%;min-width:0;padding:.6em .8em;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--bg);outline:none;
    transition:border-color .15s,box-shadow .15s}
  .field:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .field::placeholder{color:var(--muted)}
  .field-sm{padding:.4em .55em;font-size:.85em}
  .field-wrap{position:relative;display:flex;align-items:center;min-width:0}
  .field-wrap svg{position:absolute;left:.75em;color:var(--muted);pointer-events:none}
  .field-wrap .field{padding-left:2.3em}

  .seg{display:flex;gap:.2em;padding:.22em;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-sm)}
  .seg button{flex:1 1 auto;min-width:0;padding:.42em .5em;border:0;border-radius:.55em;background:none;color:var(--muted);font-size:.86em;
    font-weight:500;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .15s,color .15s}
  .seg button:hover:not(:disabled){color:var(--text)}
  .seg button[aria-pressed=true]{background:var(--surface-2);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.45)}
  .seg button:disabled{cursor:default}

  .chip{display:inline-flex;align-items:center;gap:.3em;padding:.12em .55em;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:.78em;white-space:nowrap}
  .dot{width:.55em;height:.55em;border-radius:50%;flex:none}

  .check{appearance:none;width:1.25em;height:1.25em;flex:none;margin:0;border-radius:50%;border:1.5px solid var(--line-2);cursor:pointer;
    display:grid;place-items:center;transition:background .15s,border-color .15s}
  .check:hover{border-color:var(--muted)}
  .check:checked{background:var(--accent);border-color:var(--accent)}
  .check:checked::after{content:"";width:.3em;height:.55em;border:solid #fff;border-width:0 2px 2px 0;transform:translateY(-.06em) rotate(45deg)}

  .switch{appearance:none;width:2.2em;height:1.25em;flex:none;margin:0;border-radius:999px;background:var(--surface-2);border:1px solid var(--line-2);
    position:relative;cursor:pointer;transition:background .2s}
  .switch::after{content:"";position:absolute;top:50%;left:.15em;width:.85em;height:.85em;border-radius:50%;background:var(--muted);
    transform:translateY(-50%);transition:left .2s,background .2s}
  .switch:checked{background:#ff6b6b33;border-color:#ff6b6b}
  .switch:checked::after{left:1.15em;background:#ff6b6b}

  .pn input[type=range]{width:100%;accent-color:var(--accent);margin:0}
  .pn :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .pn ::-webkit-scrollbar{width:8px}
  .pn ::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:4px}
  @keyframes pn-pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes pn-sprite{to{background-position-x:-10.4em}} /* 4 cuadros de 2.6em */
  @keyframes pn-sprite-lg{to{background-position-x:-14.4em}} /* 4 cuadros de 3.6em */
  @media (prefers-reduced-motion:reduce){.pn *{animation:none!important;transition:none!important}}
`;
