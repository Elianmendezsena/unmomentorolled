# Un Momento Rolled

Caja registradora (POS) instalable como app web. Frontend estático en GitHub Pages + Supabase (base de datos, cuentas, tiempo real).

- `index.html` — la app completa. `js/db.js` — capa de datos (habla con Supabase).
- `supabase/` — tablas, reglas de seguridad (RLS) y funciones del servidor (códigos y PIN con bcrypt, límite de intentos).
- `config.js` — URL y llave **pública** (publishable) de Supabase. La seguridad la dan las reglas y las cuentas, no esta llave.
- `tests/` — `node tests/db.test.js` y `node tests/e2e.js` (Playwright) contra un Supabase simulado.

## Cuentas
Crear usuarios en Supabase → Authentication → Users, y darles rol en la tabla `staff` (`admin` o `cajero`).
- `admin`: todo. `cajero` (cuenta compartida del equipo de caja): cobra, abre/cierra caja, cuenta inventario; no cambia precios ni ajustes.

## Etapa 2 (pendiente)
Modo sin internet con cola de ventas, impresión directa en la térmica, copias de seguridad.
