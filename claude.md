{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # Contexto del proyecto\
\
App personal de gesti\'f3n: tareas, correo, calendario y reuniones.\
Front HTML/CSS/JS plano sin framework ni bundler, en GitHub Pages\
bajo /TM/. Backend Supabase (Postgres + Edge Functions + pg_cron).\
\
## Estado y objetivo\
- Hoy: un solo usuario real, el propietario. En uso diario.\
- Objetivo actual: app nativa iOS con Capacitor, solo para \'e9l.\
  No hay publicaci\'f3n en tiendas ni multiusuario p\'fablico.\
- Los datos incluyen informaci\'f3n profesional sensible.\
\
## Reglas permanentes\
- La app web y la PWA est\'e1n EN PRODUCCI\'d3N. Ning\'fan cambio puede\
  interrumpirlas sin avisar antes y acordar una ventana.\
- No cambiar la clave primaria "id text" de las tablas de\
  negocio. El cliente hace upsert por id y no env\'eda user_id;\
  una clave compuesta romper\'eda los guardados en silencio.\
- No modificar el front salvo petici\'f3n expl\'edcita.\
- Todo cambio de esquema en supabase/migrations, fechado,\
  idempotente y con rollback. Nunca cambios a mano en el panel.\
- Sin bundler ni framework: es una decisi\'f3n, no una carencia.\
  No proponer migrar a React, Vite ni similares.\
- Principio de m\'ednimo privilegio en scopes de Google.\
\
## C\'f3mo trabajar aqu\'ed\
- Antes de proponer una mejora fuera del encargo, pregunta.\
- Un bloque de trabajo cada vez. No mezclar seguridad de datos\
  con empaquetado nativo.\
- Si algo no es determinable desde el c\'f3digo, dilo. No supongas.}