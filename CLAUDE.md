# Contexto del proyecto

App personal de gestión: tareas, correo, calendario y reuniones.
Front HTML/CSS/JS plano, sin framework ni bundler, publicado en
GitHub Pages bajo /TM/. Backend Supabase (Postgres + Edge Functions
+ pg_cron).

## Estado y objetivo

- Un único usuario: el propietario. En uso diario.
- Objetivo actual: app nativa iOS con Capacitor, de uso personal.
  No hay publicación en tiendas ni multiusuario público.
- Los datos son confidenciales. Trátalos como tales.

## Reglas permanentes

- El repositorio es público y Pages sirve desde la raíz de main:
  nada bajo docs/ se commitea. Los informes técnicos viven solo
  en local.
- La app web y la PWA están EN PRODUCCIÓN. Cualquier cambio que las
  afecte se avisa antes y se hace en una ventana acordada.
- Mantener la clave primaria "id text" de las tablas de negocio tal
  y como está.
- No modificar el front salvo petición explícita.
- Todo cambio de esquema va en supabase/migrations, fechado,
  idempotente y con su vuelta atrás. Los cambios se aplican desde
  migraciones, nunca a mano en el panel.
- Sin bundler ni framework: es una decisión, no una carencia.
  No proponer migrar a React, Vite ni similares.
- Principio de mínimo privilegio en los scopes de Google.

## Cómo trabajar aquí

- Antes de proponer una mejora fuera del encargo, pregunta.
- Un bloque de trabajo cada vez. No mezclar seguridad de datos con
  empaquetado nativo.
- Si algo no es determinable desde el código, dilo. No supongas.
