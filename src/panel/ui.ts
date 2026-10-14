export const T = {
  bg: "#16161d",
  card: "rgba(255,255,255,.06)",
  line: "rgba(255,255,255,.10)",
  text: "#ececf1",
  dim: "#8b8b99",
  accent: "#e8523c",
} as const;

export const btn = {
  padding: "8px 12px",
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
