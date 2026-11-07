# Cliente OAuth de Google (Calendar + Gmail)

"Iniciar sesión con Google" (Ajustes → Conexiones, `src-tauri/src/google.rs`) necesita un cliente OAuth propio.
Sin él la app compila igual y el botón aparece apagado.

## 1. Proyecto y APIs
1. https://console.cloud.google.com → crear proyecto (p. ej. `candola`).
2. APIs y servicios → Biblioteca → habilitar **Google Calendar API** y **Gmail API**.

## 2. Pantalla de consentimiento (Google Auth Platform)
1. Branding: nombre `Candola`, correo de soporte, logo opcional, dominio `spadelab.xyz` (+ política de privacidad
   para cuando se verifique).
2. Público: tipo **Externo**, estado **Testing** (Prueba).
3. **Usuarios de prueba**: agregar cada cuenta que vaya a conectarse (tú y los testers). Máximo 100.
4. Acceso a datos → agregar scopes:
   - `https://www.googleapis.com/auth/calendar.readonly` (sensible)
   - `https://www.googleapis.com/auth/gmail.readonly` (**restringido**)

## 3. Cliente
Clientes → Crear cliente → tipo **App de escritorio** (Desktop app), nombre `Candola desktop`.
No hay que registrar redirect URIs: la app usa `http://127.0.0.1:<puerto al azar>` con PKCE.
Copiar **Client ID** y **Client secret** (en apps de escritorio el secret no es secreto; Google lo asume público).

## 4. Dónde van los valores
Se leen al compilar (`option_env!`), y en dev también del entorno al correr:

```sh
export GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
pnpm tauri dev        # o pnpm tauri build
```

Release de Windows (`.github/workflows/windows.yml`): crear los secrets del repo `GOOGLE_CLIENT_ID` y
`GOOGLE_CLIENT_SECRET` (Settings → Secrets and variables → Actions). No los subas a git.

## Límites mientras siga en Testing
- Solo los usuarios de prueba pueden conectarse (los demás ven "acceso bloqueado"); máximo 100.
- Verán la advertencia "Google no verificó esta app" → Continuar.
- **Los refresh tokens vencen a los 7 días**: la app avisa "La sesión de Google venció…" y hay que volver a conectar.
  Mientras tanto el calendario cae a la URL iCal si está puesta.
- Salir de Testing exige verificación: Calendar (sensible) es una revisión normal; Gmail (restringido) además pide una
  evaluación de seguridad (CASA) anual, de pago. Si Gmail no hace falta para todos, quitar ese scope de `SCOPES`
  en `google.rs` deja solo la verificación de Calendar.

## Por qué `gmail.readonly` y no `gmail.metadata`
Google describe `gmail.metadata` como "cabeceras y labels, sin cuerpo"; el snippet es texto del cuerpo y la doc no
garantiza que venga con ese scope (sin probar con una cuenta real), y además metadata no acepta búsquedas `q`. Las dos son
restringidas, así que metadata no ahorra trámite. Igual la app solo pide `format=metadata` (From, Subject) + snippet:
nunca baja cuerpos. Si se prueba que metadata trae snippet, basta cambiar el scope en `SCOPES`.
