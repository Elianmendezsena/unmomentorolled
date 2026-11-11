# Un Momento Rolled

Caja registradora (POS) instalable como app web. Frontend estático en GitHub Pages + Supabase (base de datos, cuentas, tiempo real).

- `index.html` — la app completa. `js/db.js` — capa de datos (habla con Supabase).
- `supabase/` — tablas, reglas de seguridad (RLS) y funciones del servidor (códigos y PIN con bcrypt, límite de intentos).
- `config.js` — URL y llave **pública** (publishable) de Supabase. La seguridad la dan las reglas y las cuentas, no esta llave.
- `tests/` — `node tests/db.test.js` y `node tests/e2e.js` (Playwright) contra un Supabase simulado.

## Cuentas
Crear usuarios en Supabase → Authentication → Users, y darles rol en la tabla `staff` (`admin` o `cajero`).
- `admin`: todo. `cajero` (cuenta compartida del equipo de caja): cobra, abre/cierra caja, cuenta inventario; no cambia precios ni ajustes.

## Etapa 2
- **Sin internet:** las ventas y cambios se guardan en el equipo y se envían solos al volver la conexión (el aviso arriba muestra cuántos faltan). Sin internet solo entran códigos de cajero que ya se usaron antes en ese equipo; descuentos y anulaciones necesitan internet.
- **Respaldos:** Ajustes → "Respaldo de los datos" (JSON completo o Excel). Cada 7 días se descarga solo al entrar el administrador, y el servidor guarda una copia interna cada lunes (`supabase/005_respaldo_semanal.sql`).
- **Descuentos y anulaciones:** el servidor exige una autorización de un solo uso obtenida con el código del administrador (`supabase/004_autorizacion_servidor.sql`).
- **Resumen por WhatsApp:** botón en Apertura y cierre, con el número configurable en Ajustes.
- **Impresión directa:** ver `IMPRESION-DIRECTA.md`.

## Mantenimiento
- **Versión nueva:** al publicar, subir el número de `V` en `sw.js`. Los equipos abiertos muestran el aviso "Hay una versión nueva — Actualizar".
- **Sin internet:** la app completa (incluido el generador de Excel) queda guardada en el equipo desde la primera vez que se abre.
- Documentos legales y accesibilidad: ver "Privacidad y términos" en el pie de la app.
