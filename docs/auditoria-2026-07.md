{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 Auditor\'eda de solo lectura. No voy a modificar nada. Recojo evidencias:\
\
Auditor\'eda completada. No he modificado ning\'fan archivo.\
\
## Autenticaci\'f3n y Google\
\
**1. OAuth de usuario, no cuenta de servicio.** No hay delegaci\'f3n de dominio ni credenciales de servicio en el repositorio. El inicio de sesi\'f3n es `signInWithOAuth(\{provider:'google'\})` a trav\'e9s de Supabase Auth \'97 [js/05-auth-google.js:121](js/05-auth-google.js:121). El \'fanico rol privilegiado es el `service_role` de Supabase, que es interno a Supabase y no una identidad de Google \'97 [supabase/functions/google-token/index.ts:16](supabase/functions/google-token/index.ts:16).\
\
**2. Scopes solicitados**, literal \'97 [js/05-auth-google.js:7](js/05-auth-google.js:7):\
\
```\
https://www.googleapis.com/auth/calendar.readonly\
https://www.googleapis.com/auth/calendar.events\
https://www.googleapis.com/auth/gmail.modify\
https://www.googleapis.com/auth/gmail.settings.basic\
https://www.googleapis.com/auth/tasks\
https://www.googleapis.com/auth/drive.readonly\
```\
\
**3. Tipo de cliente OAuth y redirect URIs: NO DETERMINABLE** desde el c\'f3digo. El cliente OAuth se configura en Google Cloud Console y se registra en el panel de Supabase; ni el `client_id` ni el tipo aparecen en el repositorio. Lo \'fanico deducible es que el `redirect_uri` real ante Google es el de Supabase (`https://<proyecto>.supabase.co/auth/v1/callback`), porque el intercambio lo hace Supabase; el `redirectTo` del c\'f3digo es solo el retorno posterior al navegador, calculado din\'e1micamente como `window.location.origin + window.location.pathname` \'97 [js/05-auth-google.js:125](js/05-auth-google.js:125). Por comportamiento, tiene que ser un cliente **web**.\
\
**4. Authorization code con PKCE**, declarado expl\'edcitamente: `flowType:'pkce'` \'97 [js/05-auth-google.js:54](js/05-auth-google.js:54). Librer\'eda: `@supabase/supabase-js@2`, cargada por CDN \'97 [index.html](index.html) (jsdelivr). Se piden `access_type:'offline'` y `prompt:'consent'` para obtener refresh token \'97 [js/05-auth-google.js:126](js/05-auth-google.js:126).\
\
**5. Client secret y intercambio de c\'f3digo.** El secret **no est\'e1 en el repositorio**. Vive en dos sitios, ambos de servidor:\
- El del proveedor Google de Supabase Auth: en el panel de Supabase (**NO DETERMINABLE** desde el c\'f3digo).\
- El de la Edge Function: variable de entorno `GOOGLE_CLIENT_SECRET` \'97 [supabase/functions/google-token/index.ts:14](supabase/functions/google-token/index.ts:14) y [supabase/functions/push-check/index.ts:13](supabase/functions/push-check/index.ts:13).\
\
El intercambio de c\'f3digo ocurre **en servidor** (Supabase Auth). El refresco posterior tambi\'e9n, contra `https://oauth2.googleapis.com/token` desde la Edge Function \'97 [supabase/functions/google-token/index.ts:99](supabase/functions/google-token/index.ts:99).\
\
**6. Almacenamiento de tokens.**\
\
| | D\'f3nde | Cifrado |\
|---|---|---|\
| Refresh token de Google | Tabla `public.google_tokens`, columna `refresh_token`, tipo `text` \'97 [supabase/migrations/20260727090000_google_tokens.sql](supabase/migrations/20260727090000_google_tokens.sql) | **En claro**. Solo protegido por RLS activado sin pol\'edticas + `revoke all` a `anon` y `authenticated`; \'fanicamente accesible con `service_role` |\
| Access token de Google | Variable `googleToken`, en memoria del navegador \'97 [js/05-auth-google.js:8](js/05-auth-google.js:8) | No persiste |\
| Sesi\'f3n de Supabase (JWT + su refresh) | `localStorage`, gestionado por supabase-js con `persistSession:true` \'97 [js/05-auth-google.js:54](js/05-auth-google.js:54) | En claro |\
\
Matiz relevante: el `provider_refresh_token` **s\'ed pasa por el navegador** una vez, tras el login, para reenviarlo a la funci\'f3n que lo custodia \'97 [js/05-auth-google.js:78-79](js/05-auth-google.js:78).\
\
## Arquitectura\
\
**7. Front:** HTML/CSS/JavaScript planos. **Sin framework y sin bundler** \'97 no existe `package.json`, `vite.config`, `webpack` ni `tsconfig`. Son 18 archivos `<script>` cl\'e1sicos cargados en orden, ~7.945 l\'edneas \'97 [index.html](index.html), `js/*.js`. Hosting: GitHub Pages (`https://jalom-fgulem.github.io`, ruta `/TM/`) \'97 [supabase/functions/google-token/index.ts:20](supabase/functions/google-token/index.ts:20).\
\
**Backend propio: s\'ed, pero m\'ednimo.** Supabase: PostgreSQL + PostgREST + tres Edge Functions en Deno/TypeScript (`google-token`, `push-subscribe`, `push-check`) + `pg_cron`. Todo el trato con Gmail lo hace el cliente **salvo** el vigilante de notificaciones.\
\
**8. Contenido de correo en servidor: s\'ed, parcialmente.**\
\
- La Edge Function `push-check` lee de Gmail **remitente, asunto y resumen (`snippet`)** y los mete en el cuerpo de la notificaci\'f3n \'97 [supabase/functions/push-check/index.ts:95-108](supabase/functions/push-check/index.ts:95).\
- **No se persisten** en base de datos: en `notif_state` solo se guardan `last_unread` (un n\'famero) y `avisados` (claves de aviso ya enviadas) \'97 [supabase/functions/push-check/index.ts:258](supabase/functions/push-check/index.ts:258).\
- **Cuerpos y adjuntos nunca tocan servidor propio**: van del navegador a Gmail directamente.\
- **Cach\'e9 persistente de mensajes: no.** `_correosCargados` es memoria vol\'e1til \'97 [js/08-gmail.js:7](js/08-gmail.js:7). El service worker precachea solo `'./'`, aunque su estrategia *network-first* **s\'ed guarda en cach\'e9 toda respuesta del mismo origen** \'97 [sw.js:26](sw.js:26); como Gmail es otro origen, queda excluido por el filtro de la l\'ednea 18.\
\
**9. Endpoints de Gmail invocados** \'97 [js/08-gmail.js](js/08-gmail.js), [js/08b-thread.js](js/08b-thread.js), [js/08c-acciones.js](js/08c-acciones.js), [js/10-compose.js](js/10-compose.js), [js/07c-reglas.js](js/07c-reglas.js):\
\
```\
messages, messages/\{id\}, messages/\{id\}/modify, messages/\{id\}/attachments/\{id\}\
messages/send, upload/.../messages/send?uploadType=media\
threads/\{id\}, threads/\{id\}/\{modify|trash|untrash\}\
labels, labels/\{id\}, drafts, profile\
settings/sendAs, settings/filters, settings/filters/\{id\}\
```\
\
**Polling, no watch + Pub/Sub.** Se consulta `users/me/profile` y se compara el `historyId` cada 45 s \'97 [js/08-gmail.js:371-411](js/08-gmail.js:371). En servidor, `pg_cron` ejecuta `push-check` **cada 3 minutos** \'97 [supabase/migrations/20260728150000_cron_push.sql:21](supabase/migrations/20260728150000_cron_push.sql:21).\
\
**10. Google Calendar API**, no calendario nativo: `calendar/v3/calendars/\{id\}/events` y `calendar/v3/users/me/calendarList` \'97 [js/06-calendar.js](js/06-calendar.js).\
\
**11. Web Push** con VAPID (`jsr:@negrel/webpush@0.3`) \'97 [supabase/functions/push-check/index.ts](supabase/functions/push-check/index.ts), [js/12-push.js](js/12-push.js). Adicionalmente, avisos locales v\'eda `Notification` desde el service worker \'97 [sw.js](sw.js), [js/11-pwa-boot.js:37](js/11-pwa-boot.js:37).\
\
## Datos\
\
**12. Modelo de datos y multiusuario.** Dos reg\'edmenes distintos conviviendo:\
\
**Tablas de negocio** (`tasks`, `projects`, `meetings`, `contacts`, `notes`, `board`) \'97 [supabase/migrations/20260703072346_split_board_tables.sql](supabase/migrations/20260703072346_split_board_tables.sql):\
\
```sql\
id text primary key, data jsonb not null, updated_at timestamptz\
```\
\
**No est\'e1n preparadas para multiusuario.** No existe columna `user_id`, y la pol\'edtica es `for all to authenticated using (true) with check (true)` \'97 [migraci\'f3n:47](supabase/migrations/20260703072346_split_board_tables.sql:47) y [20260727120000_require_login.sql](supabase/migrations/20260727120000_require_login.sql). Es decir: **RLS est\'e1 activado pero no a\'edsla nada**; cualquier usuario autenticado ve y modifica los datos de todos. Hoy es monousuario de hecho, no por dise\'f1o. Adem\'e1s `board` cuelga de una \'fanica clave literal `'tablero-fgulem-datos'` \'97 [js/01-core.js:4](js/01-core.js:4).\
\
**Tablas de infraestructura** s\'ed est\'e1n bien: `google_tokens`, `push_subscriptions` y `notif_state` tienen `user_id uuid references auth.users(id)` \'97 [20260727090000_google_tokens.sql](supabase/migrations/20260727090000_google_tokens.sql), [20260728140000_push.sql:10,26](supabase/migrations/20260728140000_push.sql:10).\
\
**13. Almacenamiento en cliente.**\
- `localStorage`: sesi\'f3n de Supabase (supabase-js con `persistSession:true`) \'97 [js/05-auth-google.js:54](js/05-auth-google.js:54).\
- **IndexedDB: no se usa.**\
- Service worker `tm-v6` \'97 [sw.js:2](sw.js:2): precachea `'./'`; en `fetch`, *network-first* con `cache:'no-cache'` y guarda copia de **toda** respuesta del propio origen; `caches.match` solo como respaldo sin red.\
\
## Preparaci\'f3n para nativo\
\
**14. SPA sin rutas, pero con dependencia de rutas absolutas.** No hay enrutador ni build. Los `<script src="js/\'85">` son relativos, pero hay **rutas absolutas `/TM/`** en puntos cr\'edticos:\
- `start_url`, `scope` e `icons` \'97 [manifest.json](manifest.json)\
- `manifest`, `apple-touch-icon`, favicons \'97 [index.html:10-14](index.html:10)\
- registro del service worker: `navigator.serviceWorker.register('/TM/sw.js')` \'97 [js/11-pwa-boot.js:27](js/11-pwa-boot.js:27)\
- iconos de notificaci\'f3n \'97 [js/11-pwa-boot.js:37](js/11-pwa-boot.js:37), [sw.js:44](sw.js:44)\
- destino de los avisos push: `'/TM/#abrir=\'85'` \'97 [supabase/functions/push-check/index.ts:176](supabase/functions/push-check/index.ts:176)\
\
Adem\'e1s carga tres or\'edgenes externos: jsdelivr (supabase-js, Tabler), Google Fonts y `www.google.com/s2/favicons`.\
\
**15. Dependencias problem\'e1ticas en WebView.**\
\
| Qu\'e9 | D\'f3nde | Problema |\
|---|---|---|\
| Service Worker + PushManager | [js/12-push.js](js/12-push.js), [js/11-pwa-boot.js:27](js/11-pwa-boot.js:27) | **No existen en WKWebView.** Todo el sistema de notificaciones deja de funcionar |\
| `matchMedia('(display-mode: standalone)')` y `navigator.standalone` | [js/12-push.js:9-10](js/12-push.js:9) | Detecci\'f3n de \'abapp instalada\'bb que da falso en WebView |\
| `showSaveFilePicker` | [js/08-gmail.js](js/08-gmail.js) | Ausente; hay respaldo, conviene verificarlo |\
| `SpeechRecognition` | [js/02-tasks.js:343](js/02-tasks.js:343) | No disponible en WKWebView |\
| `execCommand` + `contenteditable` | [js/10-compose.js](js/10-compose.js), [js/09b-firmas.js](js/09b-firmas.js) | Comportamiento divergente en el editor de correo |\
| HTML5 drag & drop | [js/08c-acciones.js](js/08c-acciones.js), [js/09-gtasks-ui.js](js/09-gtasks-ui.js) | No funciona con dedo |\
| `window.open(_blank)` | [js/08b-thread.js](js/08b-thread.js) | Debe pasar por el navegador del sistema |\
| `<iframe srcdoc>` sandbox | [js/08b-thread.js:294-299](js/08b-thread.js:294) | El cuerpo de todo correo HTML se renderiza ah\'ed |\
| CORS por origen | [supabase/functions/google-token/index.ts:19-23](supabase/functions/google-token/index.ts:19) | Lista blanca fija; `capacitor://localhost` no est\'e1 |\
| `beforeinstallprompt` | [js/11-pwa-boot.js](js/11-pwa-boot.js) | Sin sentido en nativo |\
\
**16. Identificadores a parametrizar.**\
- `SUPABASE_URL` y `SUPABASE_KEY` literales \'97 [js/01-core.js:5-6](js/01-core.js:5) (la clave es publicable, no un secreto)\
- `STORAGE_KEY = 'tablero-fgulem-datos'` \'97 [js/01-core.js:4](js/01-core.js:4)\
- Todas las rutas `/TM/` citadas en el punto 14\
- Lista blanca CORS `https://jalom-fgulem.github.io` y `localhost:8934/5176` \'97 [google-token/index.ts:19](supabase/functions/google-token/index.ts:19), [push-subscribe/index.ts:13](supabase/functions/push-subscribe/index.ts:13)\
- `Europe/Madrid` (8 apariciones) y `'es-ES'` (29) repartidos por `js/` y `supabase/functions/`\
- `DEFAULT_AREAS` y `DEFAULT_TIPOS`, propios de FGULEM \'97 [js/01-core.js:7-8](js/01-core.js:7)\
- Correo de ejemplo `jalom@unileon.es` \'97 [index.html:1501](index.html:1501)\
\
---\
\
## Los tres riesgos que m\'e1s probablemente rompan la app con Capacitor\
\
**1. El sistema de notificaciones desaparece por completo.** WKWebView no implementa Service Workers ni la Push API. Se caen a la vez: los avisos push, el badge del icono, la apertura del correo concreto al tocar la notificaci\'f3n y el respaldo de cach\'e9 sin conexi\'f3n \'97 [js/12-push.js](js/12-push.js), [js/11-pwa-boot.js](js/11-pwa-boot.js), [sw.js](sw.js). No es un ajuste: hay que rehacerlo con `@capacitor/push-notifications` y APNs, lo que adem\'e1s obliga a reescribir `push-check`, que hoy firma con VAPID.\
\
**2. El login con Google deja de completarse.** Confluyen tres cosas: el origen pasa a ser `capacitor://localhost`, que **no est\'e1 en la lista blanca de CORS** de las Edge Functions \'97 [google-token/index.ts:19-23](supabase/functions/google-token/index.ts:19); el `redirectTo` se calcula desde `window.location`, que ya no es una URL http v\'e1lida como retorno OAuth \'97 [js/05-auth-google.js:125](js/05-auth-google.js:125); y Google no admite esquemas personalizados en clientes web. Sin login no hay token, y sin token no hay nada: correo, calendario y tareas quedan inaccesibles.\
\
**3. Las rutas absolutas `/TM/` dejan de resolver.** En Capacitor la ra\'edz es `/`, as\'ed que `manifest.json`, los favicons, el registro del service worker y los iconos de notificaci\'f3n apuntan a rutas inexistentes \'97 [index.html:10-14](index.html:10), [js/11-pwa-boot.js:27](js/11-pwa-boot.js:27), [sw.js:44](sw.js:44). Y el enlace profundo de los avisos (`/TM/#abrir=\'85`), que se genera **en el servidor**, seguir\'eda apuntando a la web aunque el resto se arreglara \'97 [push-check/index.ts:176](supabase/functions/push-check/index.ts:176).\
\
Menci\'f3n aparte, porque no rompe el empaquetado pero s\'ed es el hallazgo m\'e1s serio de la auditor\'eda: **las tablas de negocio no a\'edslan por usuario**. La pol\'edtica es `using (true)` sin `user_id` \'97 [20260703072346_split_board_tables.sql:47](supabase/migrations/20260703072346_split_board_tables.sql:47). Mientras seas el \'fanico usuario no tiene consecuencias, pero en cuanto entre una segunda cuenta \'97o si alguien consigue registrarse\'97 ver\'eda y podr\'eda borrar todo tu CRM, tareas y reuniones.}