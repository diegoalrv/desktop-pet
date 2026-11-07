# Cliente OAuth de Google (Calendar + Gmail)

"Iniciar sesión con Google" (Ajustes → Conexiones, `src-tauri/src/google.rs`) necesita un cliente OAuth propio.
Sin él la app compila igual y el botón aparece apagado.

Qué hace con la cuenta: lee el calendario principal (avisos y reunión en curso), y desde el chat de la Candola crea,
mueve o borra eventos y envía correos, **siempre** tras el clic del usuario en la tarjeta de confirmación
(`src/lib/googleTools.ts`). No lee correos.

## 1. Proyecto y APIs
1. https://console.cloud.google.com → crear proyecto (p. ej. `candola`).
2. APIs y servicios → Biblioteca → habilitar **Google Calendar API** y **Gmail API**.

## 2. Pantalla de consentimiento (Google Auth Platform)
1. Branding: nombre `Candola`, correo de soporte, logo, dominio autorizado `spadelab.xyz`, enlaces a la página
   principal y a la política de privacidad (hacen falta para verificar).
2. Público: tipo **Externo**, estado **Testing** (Prueba) mientras no esté verificada.
3. **Usuarios de prueba**: cada cuenta que vaya a conectarse en Testing (máximo 100).
4. Acceso a datos → agregar scopes:
   - `openid`, `.../auth/userinfo.email` (no sensibles: el mail para "Conectado como…")
   - `https://www.googleapis.com/auth/calendar.events` (**sensible**: ver y editar eventos)
   - `https://www.googleapis.com/auth/gmail.send` (**sensible**: solo enviar)

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

## Mientras siga en Testing
- Solo los usuarios de prueba pueden conectarse (máx. 100) y ven "Google no verificó esta app" → Continuar.
- **Los refresh tokens vencen a los 7 días**: la app avisa "La sesión de Google venció…" y hay que volver a conectar.
  Mientras tanto el calendario cae a la URL iCal si está puesta.

## Verificación (para publicarla)
Los dos scopes son **sensibles**, no restringidos: la verificación es gratis y sin evaluación de seguridad (CASA).
Pide:
- Dominio verificado en Search Console (`spadelab.xyz`) y la página principal en ese dominio.
- Política de privacidad pública que diga qué datos de Google usa y para qué (calendario y envío de correos, que
  el texto de eventos puede pasar por el proxy de IA, que no se venden ni se comparten).
- Video de demo (YouTube, puede ser no listado): pantalla de consentimiento con el client_id visible, y cada scope
  en uso (aviso de reunión, crear/mover un evento y enviar un correo desde el chat, con la tarjeta de confirmación).
- Justificación por scope en el formulario.

Mientras la app no lea correos no hace falta CASA. Si algún día se agrega `gmail.readonly`/`gmail.metadata`
(restringidos), y más aún si ese contenido va al proxy de IA, pasa a exigir CASA anual y de pago.
