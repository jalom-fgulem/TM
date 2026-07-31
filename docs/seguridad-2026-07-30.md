# Aseguramiento previo a Capacitor — 30 de julio de 2026

Proyecto Supabase `awnitqzydpqvbjxqgjfk` (Task-manager). Un solo usuario real:
`jalom@unileon.es` (`e71d554b-cc03-4e05-99ef-09c85b408e80`).

Front **no modificado**: ni una línea de JavaScript. Todo el cambio es de base
de datos y de configuración del proveedor de identidad.

---

## 0. Copia de seguridad

`supabase db dump` **no pudo ejecutarse**: necesita Docker, y en este equipo no
hay ni Docker ni `pg_dump`. La copia se hizo por vía lógica, a través de la API
de gestión, antes de la primera migración.

Ubicación: `~/Documents/TM-backups/` (fuera del repositorio, permisos 700/600).

| Archivo | Filas |
|---|---|
| `20260730_pre_seguridad_tasks.json` | 41 |
| `20260730_pre_seguridad_projects.json` | 12 |
| `20260730_pre_seguridad_meetings.json` | 6 |
| `20260730_pre_seguridad_contacts.json` | 17 |
| `20260730_pre_seguridad_notes.json` | 0 |
| `20260730_pre_seguridad_board.json` | 1 |
| `20260730_pre_seguridad_google_tokens.json` | 1 |
| `20260730_pre_seguridad_push_subscriptions.json` | 2 |
| `20260730_pre_seguridad_notif_state.json` | 1 |
| `20260730_pre_seguridad_auth_users.json` | 1 |
| `20260730_pre_seguridad_esquema.json` | políticas, permisos, columnas, índices, RLS |

Verificada: los diez archivos abren como JSON válido y los recuentos coinciden
con la base. Tras las migraciones los recuentos siguen siendo los mismos: **no
se ha perdido ni una fila**.

> **Aviso:** `20260730_pre_seguridad_google_tokens.json` contiene el pase de
> renovación de Google **en claro**. Bórralo cuando ya no haga falta la copia.

---

## 1. Cerrojo de registros

**a) Panel.** Confirmado primero que la cuenta del propietario ya existía en
`auth.users` (creada el 27/07/2026). Después, `disable_signup` pasó de `false`
a **`true`** mediante una llamada quirúrgica a la API de gestión (solo ese
campo; no se tocó nada más de la configuración de Auth, y el proveedor Google
sigue activo).

**b) Refuerzo independiente del panel.** Migración
`20260730200000_cerrojo_registro.sql`:

- Tabla `public.allowed_emails` (RLS activo, sin políticas, sin permisos para
  `anon` ni `authenticated`). La lista está **en la tabla, no en el código del
  disparador**: ampliarla es un `INSERT`, no una migración.
- Sembrada leyendo `auth.users` — ningún correo literal escrito en la migración.
- Disparador `BEFORE INSERT` en `auth.users` que rechaza cualquier correo fuera
  de la lista. Normaliza a minúsculas.

Migración añadida, `20260730202000_revocar_ejecucion_disparador.sql`: el linter
de seguridad avisó de que Supabase concede `EXECUTE` sobre las funciones nuevas
de `public` a `anon` y `authenticated` por privilegios por defecto, y eso no lo
quita un `revoke from public`. Riesgo real nulo (Postgres no deja llamar
directamente a una función de disparador), pero no hay motivo para dejarlo
expuesto por la API. Recomprobado después: el cerrojo sigue rechazando.

Tras el cambio, el linter de seguridad solo deja dos avisos, **ambos previos y
ajenos a este trabajo**: `pg_net` instalado en el esquema `public`, y la
protección de contraseñas filtradas desactivada (irrelevante aquí: no hay
contraseñas, solo entrada con Google).

Rollback: `supabase/rollback/20260730200000_cerrojo_registro_rollback.sql`
(el `drop function` cubre también las revocaciones).

---

## 2. Aislamiento por usuario

Migración `20260730201000_aislamiento_por_usuario.sql`, sobre `tasks`,
`projects`, `meetings`, `contacts`, `notes` y `board`:

- **a)** `user_id uuid not null references auth.users(id) on delete cascade`
  con `default auth.uid()`.
- **b)** Backfill consultando el id en `auth.users`, sin UUID ni correo literal.
  Si hubiera más de una cuenta y filas sin dueño, la migración **aborta con
  excepción**. Si no queda nada por asignar, el bloque se salta entero (por eso
  puede reejecutarse sin daño).
- **c)** Clave primaria intacta: sigue siendo `id text primary key`. Como
  `user_id` se rellena solo por `DEFAULT auth.uid()`, los `upsert` del front
  siguen funcionando sin tocar el JavaScript.
- **d)** Eliminada la política `for all ... using (true) with check (true)`.
  En su lugar, cuatro políticas por tabla (select / insert / update / delete)
  con `auth.uid() = user_id` en `using` y en `with check`. 24 políticas en total.
- **e)** Índice `<tabla>_user_id_idx` en las seis.
- **f)** RLS verificado como activo en las seis.

Rollback: `supabase/rollback/20260730201000_aislamiento_por_usuario_rollback.sql`
(elimina la columna y restaura la política antigua; no borra filas).

### Consecuencia conocida de mantener la clave primaria simple

`board` usa como id la constante literal `'tablero-fgulem-datos'`, igual para
todos. Un segundo usuario no podría crear su propia fila: chocaría con la del
propietario y RLS le impediría actualizarla. **No hay fuga** — simplemente ese
usuario se quedaría sin ajustes. Se resuelve en la fase multiusuario, junto con
la clave compuesta, tal y como estaba previsto.

---

## 3. Tokens

### a) Cifrado del refresh token con Vault: **no es viable sin tocar las Edge Functions**

Dicho explícitamente, sin improvisar una solución a medias:

- `supabase_vault 0.3.1` está instalado, y guarda los secretos en `vault.secrets`,
  legibles a través de `vault.decrypted_secrets`.
- Ese esquema **solo es accesible desde SQL**. PostgREST no lo expone.
- Las tres Edge Functions leen `google_tokens` por PostgREST
  (`admin.from('google_tokens')`). Para dejar el token cifrado en reposo habría
  que sustituir esas lecturas por una función RPC `security definer` en `public`
  que devuelva el valor descifrado, y reescribir `google-token/index.ts` y
  `push-check/index.ts`.

Es decir: **exige modificar las Edge Functions**, que es justo lo que se pidió
no improvisar. Queda como bloque de trabajo aparte, si se decide abordarlo.

Protección actual del token, que no es poca: RLS activo, **cero políticas**, y
cero permisos para `anon` y `authenticated` (verificado por HTTP más abajo).
Solo `service_role` llega. El riesgo residual real es quien tenga la clave
`service_role`, acceso al panel o acceso a la base — y la copia de seguridad de
hoy.

### Procedimiento de rotación del pase de renovación de Google

1. **Revocar** en [myaccount.google.com](https://myaccount.google.com) →
   Seguridad → Acceso de terceros → quitar la aplicación. Google invalida el
   refresh token en el acto.
2. La siguiente llamada de la app recibe `invalid_grant`; `google-token` borra
   la fila de `google_tokens` y devuelve `reauth_required` (409). La app muestra
   «Hay que volver a autorizar Google».
3. **Reautorizar** desde Ajustes → Google → Reconectar (o «Entrar con Google»).
   El botón usa `access_type=offline` y `prompt=consent`, así que Google entrega
   un pase de renovación nuevo, que se guarda en servidor.
4. **Comprobar**: `select user_id, updated_at from public.google_tokens;` debe
   mostrar fecha de hoy, y `select status_code from net._http_response order by
   created desc limit 5;` debe seguir devolviendo 200 (el vigilante refresca el
   pase cada minuto: si el token estuviera mal, dejaría de funcionar enseguida).

Rotación forzada sin revocar en Google: `delete from public.google_tokens where
user_id = '<id>';` y repetir el paso 3.

Aparte, conviene rotar cada cierto tiempo el `GOOGLE_CLIENT_SECRET` en Google
Cloud Console y actualizarlo con `supabase secrets set`.

### b) Acceso a `google_tokens` desde `anon` / `authenticated`: **ninguno**

Verificado por dos vías. En el catálogo: cero filas en
`information_schema.role_table_grants` para `anon` y `authenticated` sobre
`google_tokens`, `push_subscriptions`, `notif_state` y `allowed_emails`; RLS
activo y ninguna política. Y por HTTP real contra PostgREST con la clave
publicable:

```
google_tokens  -> HTTP 401  permission denied for table google_tokens
allowed_emails -> HTTP 401
tasks (anon)   -> HTTP 401
```

### c) El `provider_refresh_token` que pasa por el navegador: **no puede evitarse hoy**

Con la arquitectura actual, no. El intercambio del código lo hace Supabase Auth
como proveedor de Google, y Supabase entrega el `provider_refresh_token` **una
sola vez, dentro de la sesión que devuelve al cliente**. No hay endpoint de
servidor para recuperarlo después: por eso `js/05-auth-google.js` lo reenvía a
la Edge Function (`storeRefreshToken`) nada más iniciar sesión.

La única forma de que no pase por el navegador es **hacer tú el intercambio
OAuth**: un `redirect_uri` apuntando a una Edge Function propia que reciba el
código, lo canjee contra Google, guarde el refresh token y solo entonces cree la
sesión de Supabase. Eso cambia el flujo de login entero y el front — fuera del
encargo de hoy, y además choca con el punto 2 de los riesgos de Capacitor de la
auditoría, así que tiene sentido decidirlo junto con el empaquetado nativo.

**Pendiente de comprobar (no determinable desde el código):** supabase-js guarda
la sesión completa en `localStorage`. Habría que mirar en las herramientas de
desarrollador, clave `sb-awnitqzydpqvbjxqgjfk-auth-token`, si el
`provider_refresh_token` queda ahí escrito de forma persistente o solo viaja en
memoria. Si queda, es un dato a tener en cuenta para el WebView nativo.

---

## 4. Scopes de Google — **no se ha tocado nada**

Antes de quitar nada, se comprobó si se usan. Los tres se usan de verdad:

| Scope | ¿Se invoca? | Dónde |
|---|---|---|
| `drive.readonly` | **Sí** | `js/08-gmail.js:314` — buscador de archivos de Drive (`drive/v3/files`) para adjuntar a tareas y reuniones |
| `gmail.settings.basic` | **Sí** | `js/07c-reglas.js:12,169,190` y `js/07d-clasificar.js:229` (`settings/filters`), `js/10-compose.js:16` (`settings/sendAs`) |
| `calendar.readonly` | **Sí, indirectamente** | `js/05-auth-google.js:236` llama a `calendar/v3/users/me/calendarList`, que `calendar.events` **no** autoriza |

Por tanto **no se elimina ningún scope** y la línea `GOOGLE_SCOPES` queda
exactamente como estaba.

**b)** Como no se retira ningún permiso, **no hay que revocar nada**: el aviso
sobre revocar en myaccount.google.com y volver a entrar con `prompt=consent`
solo aplica si se quita un scope, porque editar el código no reduce un
consentimiento ya otorgado. Queda dicho para cuando toque.

**c) Recomendación, no aplicada:** el único recorte real posible es cambiar
`calendar.readonly` por `calendar.calendarlist.readonly`, que es lo único que
se necesita de más allá de `calendar.events`. Eso **sí** exigiría revocar el
permiso y volver a entrar con `prompt=consent`, en ventana acordada.

**Antes de esa ventana, si se hace, ten en cuenta esto:** la app **no** relanza
sola la pantalla de consentimiento ante un 401 de Google. `handleGoogleExpired()`
pide un pase nuevo; si Google responde `invalid_grant`, la Edge Function borra
el token y el front se limita a mostrar «Hay que volver a autorizar Google».
Hay que pulsar el botón a mano. No es un fallo, pero es la condición previa que
se pedía confirmar, y la respuesta es que **no se cumple automáticamente**.

---

## 5. Pruebas

| | Prueba | Resultado |
|---|---|---|
| a | El propietario sigue viendo el 100% de sus datos | **Correcto.** Simulando su JWT: tasks 41, projects 12, meetings 6, contacts 17, notes 0, board 1 — idénticos a antes |
| b | Se rechaza el registro de una segunda cuenta | **Correcto.** `intruso.prueba@example.com` → «Registro no permitido para esta cuenta». Un correo de la lista sí pasa el cerrojo (probado con mayúsculas, para verificar la normalización). Además, `disable_signup = true` en el panel |
| c | Un segundo usuario no ve ni toca nada ajeno | **Correcto.** Segundo usuario insertado a mano: ve 0 filas en las seis tablas; `update` sobre filas ajenas afecta a 0 filas; `delete` afecta a 0 filas; `insert` suplantando el `user_id` del propietario → bloqueado (SQLSTATE 42501) |
| d | Login, correo, calendario y notificaciones siguen funcionando | **Parcial, ver abajo** |
| e | Migración de rollback probada | **Correcto.** Ambos rollbacks ejecutados y ambas migraciones reaplicadas después; estado final idéntico y sin pérdida de filas. De paso queda probada la idempotencia |

Las pruebas b y c se hicieron dentro de transacciones que **siempre se deshacen**:
después de ellas, `auth.users` sigue teniendo una sola fila y `allowed_emails`
un solo correo.

### Detalle de la prueba d

Verificado por mi parte, después de las migraciones:

- El vigilante `push-check` sigue ejecutándose **cada minuto** y devolviendo
  **HTTP 200** (20 de 20 respuestas en los últimos 20 minutos).
- `notif_state` se actualizó a las 15:40:01 UTC, ya con las migraciones
  aplicadas. Eso demuestra de paso que sigue funcionando la custodia del pase de
  Google, el refresco contra Google y la lectura de Gmail desde el servidor.
- La app web carga sin ningún error en consola y muestra la pantalla de entrada.

**Lo que no puedo verificar yo:** la sesión iniciada. Entrar con tu cuenta
requiere tus credenciales, que no debo usar. Queda a tu cargo, y es la
comprobación que cierra el punto d:

1. Abre https://jalom-fgulem.github.io/TM/ y entra con Google.
2. Comprueba que aparecen las 41 tareas, 12 proyectos, 6 reuniones y 17 contactos.
3. Crea una tarea y bórrala (verifica escritura y borrado con las políticas nuevas).
4. Abre el correo y el calendario.
5. Confirma que sigue llegando una notificación push al móvil.

Si algo fallara, la vuelta atrás es inmediata:

```bash
supabase db query --linked -f supabase/rollback/20260730201000_aislamiento_por_usuario_rollback.sql
```

---

## Fuera de encargo — anotado, no tocado

1. **`push-check` lee las tareas de todo el mundo.**
   `supabase/functions/push-check/index.ts:151` hace
   `admin.from('tasks').select('data')` **sin filtrar por usuario**, dentro de un
   bucle que ya recorre usuario por usuario. Hoy no tiene consecuencias (un solo
   usuario), pero el día que entre una segunda cuenta, cada uno recibiría avisos
   con los títulos de las tareas del otro. Es un `.eq('user_id', userId)` de
   nada, pero es una Edge Function y no estaba en el encargo. **Recomiendo
   hacerlo antes de que exista una segunda cuenta.**

2. **`board` con clave literal compartida**, descrito en el punto 2. Va con la
   clave compuesta de la fase multiusuario.

3. **`provider_refresh_token` en `localStorage`**: comprobación pendiente,
   descrita en el punto 3c.

4. Nada de esto se ha confirmado en Git: las dos migraciones y los dos rollbacks
   están escritos y aplicados, pero sin `commit`.
