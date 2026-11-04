-- Quita permisos de tabla a quien no los necesita (defensa extra además de las reglas RLS).
revoke all on admin_pin, cashier_codes, auth_attempts from anon, authenticated;
revoke all on docs, staff from anon;
revoke all on sequence auth_attempts_id_seq from anon, authenticated;
