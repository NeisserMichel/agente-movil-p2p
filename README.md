# Agente Móvil P2P

Plataforma donde los clientes mueven **su propio dinero** entre sus cuentas de distintos bancos y cajas del Perú, y **agentes verificados** hacen la transferencia con su saldo a cambio de una comisión. Agente Móvil custodia el dinero hasta que el cliente confirma que llegó.

| Carpeta / archivo | Qué es |
|---|---|
| `index.html` | Página web pública (cómo funciona, seguridad, calculadora de comisión, preguntas) |
| `app/` | La app para clientes, agentes y soporte. Se instala en el celular (PWA) |
| `app/config.js` | **Tus datos de Supabase** (URL y clave pública) |
| `supabase/schema.sql` | La base de datos completa: tablas, reglas de dinero, seguridad y archivos privados |
| `supabase/tests/` | Pruebas automáticas de todos los flujos de dinero (73 comprobaciones) |
| `android/` | App Android (abre la app web y permite subir fotos) |
| `terminos.html`, `privacidad.html` | **Borradores** legales para revisar con un abogado |
| `libro-reclamaciones.html` | Libro de Reclamaciones virtual, conectado a la base de datos |
| `tests/` | Servidor y prueba de navegador usados en desarrollo (no se usan en producción) |

---

## Lo que debes hacer tú

Marca cada paso cuando lo termines. Los pasos 1 a 6 toman unos 30 minutos y son gratis.

### 1. Crear el proyecto de Supabase
1. Entra a https://supabase.com/dashboard → **New project**.
2. Nombre `agente-movil-p2p`, región **South America (São Paulo)**, contraseña segura (guárdala tú, no la compartas).

### 2. Cargar la base de datos
1. En Supabase: **Database → Extensions** → busca **pg_cron** → actívalo. (Revisa los relojes de 20 y 60 minutos cada minuto.)
2. **SQL Editor → New query** → pega TODO el contenido de `supabase/schema.sql` → **Run**.
3. Debe terminar sin errores. Si avisa que pg_cron no está disponible, actívalo y vuelve a ejecutar el archivo completo (no borra nada).

### 3. Configurar el inicio de sesión
1. **Authentication → URL Configuration**:
   - **Site URL:** `https://neissermichel.github.io/agente-movil-p2p/app/`
   - **Redirect URLs:** agrega la misma dirección.
2. **Authentication → Sign In / Providers → Email:** deja activado **Confirm email**.
3. Importante: el correo gratuito de Supabase solo envía unos pocos correos por hora. Antes de abrir al público configura un SMTP propio en **Authentication → Emails → SMTP Settings** (Brevo o Resend tienen planes gratis).

### 4. Conectar la app
1. **Project Settings → API**: copia la **Project URL** y la clave **publishable** (o **anon public**).
2. Pégalas en `app/config.js` (o envíamelas y yo las pongo). **Nunca** compartas la clave `secret` / `service_role`.

### 5. Publicar la web y la app
**Opción A (recomendada, igual que tu app de créditos): GitHub Pages.**
1. El repositorio debe ser **público** para usar GitHub Pages gratis. Es seguro: el código no tiene claves secretas; toda la protección del dinero está en Supabase.
2. En GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)** → Save.
3. En 1–2 minutos queda en `https://neissermichel.github.io/agente-movil-p2p/` y la app en `/app/`.

**Opción B: repositorio privado + Netlify.** Conecta el repo en https://app.netlify.com → *Add new site → Import from GitHub*. Luego cambia la Site URL del paso 3 y `HOST`/`BASE` en `android/src/pe/agentemovil/p2p/MainActivity.java` por tu dirección de Netlify.

### 6. Convertirte en administrador
1. Abre la app y **regístrate** con tu correo, como cualquier cliente.
2. En Supabase → SQL Editor, ejecuta (con tu correo):
   ```sql
   update public.profiles set role = 'admin', kyc_status = 'aprobado' where email = 'tucorreo@gmail.com';
   ```
3. Cierra sesión y vuelve a entrar. Verás la pestaña **Soporte**.
4. En **Soporte → Ajustes** escribe la **cuenta recaudadora** de la empresa. Hasta que lo hagas, nadie puede crear órdenes con depósito.

### 7. Antes de mover dinero real
- [ ] **Cuenta recaudadora:** usa una cuenta empresarial a nombre de la empresa, y explícale el modelo al banco antes. Muchos depósitos de distintas personas en una cuenta común pueden hacer que el banco la congele.
- [ ] **Supabase Pro (US$25/mes):** activa copias de seguridad diarias y evita que el proyecto se pause. El plan gratis no tiene copias de seguridad.
- [ ] **Legal:** revisa `terminos.html` y `privacidad.html` con un abogado y completa los datos entre corchetes (RUC, dirección, correo). Registra el banco de datos personales ante la Autoridad de Protección de Datos.
- [ ] **SBS / UIF:** confirma con un abogado la figura regulatoria que te corresponde y haz los registros antes de abrir al público.
- [ ] **Soporte:** define el horario de atención. Los casos de 60 minutos sin respuesta necesitan a alguien que verifique con la entidad.

### 8. App Android (opcional)
1. En GitHub: **Actions → Compilar APK → Run workflow**.
2. Al terminar, el APK queda en la rama `apk-build` (`agente-movil-p2p.apk`).
3. Para que las actualizaciones se instalen sin desinstalar, crea una llave de firma fija y guárdala como secretos del repo (`ANDROID_KEYSTORE_B64` y `ANDROID_KEYSTORE_PASS`). Pídemelo y te guío.

---

## Cómo funciona por dentro

- **Ninguna pantalla cambia saldos.** La app solo llama funciones de la base de datos (`create_order`, `accept_order`, `client_confirm`, `resolve_case`, etc.). Cada función valida quién eres, qué te toca y el estado de la orden.
- **Cada quien ve solo lo suyo** (seguridad por filas). El agente no ve la cuenta del cliente hasta que acepta la orden.
- **Capturas y fotos privadas.** Se comprimen a unos 150 KB en el celular y se guardan en almacenamiento privado. Solo las ven las partes de la orden y soporte.
- **Relojes:** pg_cron revisa cada minuto. Si el agente no sube el voucher a tiempo, el dinero vuelve al saldo del cliente y el agente suma un strike. Si el cliente no responde, la orden pasa a soporte.
- **Cuadre:** el panel de soporte muestra cuánto debe haber en la cuenta recaudadora (custodia + saldos + retiros por pagar).

### Estados de una orden
`deposito_pendiente` → `deposito_revision` → `publicada` → `aceptada` (20 min) → `confirmacion` (60 min) → `completada`
Salidas: `reembolsada` (el agente no transfirió, voucher falso o titular no coincide), `revision` (soporte decide), `cancelada`, `rechazada` (depósito de un tercero).

## Probar en tu computadora (para desarrolladores)
Requiere PostgreSQL 16 y Python 3: `sh supabase/tests/correr.sh` corre los 73 casos de dinero. GitHub también los corre solo en cada cambio de `supabase/` (Actions → Pruebas de la base de datos).
