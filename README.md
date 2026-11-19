# Horarios de rol para Foundry VTT

Un planificador por semanas reales para grupos de rol, en dos partes:

- **Web** (`web/`): cada jugador entra con su usuario de Foundry, marca mañana, tarde o noche de lunes a domingo, añade notas y pulsa **Enviar semana**. Funciona aunque nadie tenga Foundry abierto.
- **Módulo de Foundry**: es el visor del grupo. Muestra el resumen de la semana, resalta los tramos con más coincidencias y permite al máster programar la próxima sesión desde un tramo.

## Cómo funciona

1. El máster abre **Horarios de rol** en Foundry y pulsa **Crear horario**. El módulo envía el nombre del mundo, el sistema y la lista de usuarios, y recibe un id de grupo. Si había disponibilidad guardada con la versión 1.x, se sube automáticamente.
2. El máster ve en el visor el enlace del grupo (la web con `?g=<id>`), con botones para abrirlo y copiarlo. Desde Foundry, el botón **Rellenar** abre la web con tu usuario ya seleccionado.
3. Cada vez que arranca el mundo, el máster vuelve a enviar el nombre, el sistema y los usuarios. También se envían al crear, borrar o renombrar usuarios. El botón de sincronizar lo fuerza a mano.

Los datos se guardan en Cloudflare D1 (gratis y no se pausa). El id de grupo hace de contraseña: quien tenga el enlace puede rellenar el horario de cualquier usuario del grupo.

## Desplegar la web (una sola vez)

Necesitas una cuenta gratuita de Cloudflare.

```bash
cd web
npm install
npx wrangler login
npx wrangler d1 create horarios-de-rol      # copia el database_id en wrangler.toml
npm run db:remote                           # crea las tablas
npm run deploy                              # te dice la URL: https://horarios-de-rol.<cuenta>.workers.dev
```

Pon esa URL en `DEFAULT_SERVER` de `scripts/horarios-de-rol.js` antes de publicar el módulo. También puede cambiarse en **Configurar ajustes → Ajustes del módulo → Servidor de horarios**.

Para probar en local: `npm run db:local` y `npm run dev` (http://localhost:8787).

## API

| Método | Ruta | Uso |
| --- | --- | --- |
| `POST` | `/api/groups` | Crea un grupo `{name, system, users}` → `{groupId, adminKey}` |
| `GET` | `/api/groups/:id` | Nombre, sistema y usuarios |
| `PUT` | `/api/groups/:id` | Actualiza nombre, sistema y usuarios (cabecera `Authorization: Bearer <adminKey>`) |
| `GET` | `/api/groups/:id/weeks/:lunes` | Disponibilidad de todos para esa semana (`YYYY-MM-DD` del lunes) |
| `POST` | `/api/groups/:id/availability` | `{userId, weeks: {"YYYY-MM-DD": horario}}`; una semana vacía se borra |

## Instalación del módulo

Desde **Instalar módulo**, con esta URL de manifiesto:

```text
https://raw.githubusercontent.com/erjavierexba/horarios-de-rol-foundry/main/module.json
```

El zip del release solo necesita `module.json`, `scripts/`, `styles/`, `templates/` y `lang/`; la carpeta `web/` no hace falta.

Compatible con Foundry VTT 12 y 13.
