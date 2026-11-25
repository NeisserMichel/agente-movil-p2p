-- =====================================================================
--  AGENTE MÓVIL P2P · Base de datos (Supabase / PostgreSQL)
--  Pegar TODO este archivo en Supabase > SQL Editor > New query > Run.
--  Se puede volver a ejecutar: no borra datos.
--
--  Principio: el celular NUNCA cambia saldos ni estados directamente.
--  Todo movimiento de dinero pasa por funciones de esta base de datos
--  que validan quién eres, qué te toca y en qué estado está la orden.
-- =====================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------
-- 1. AJUSTES (una sola fila, editable por el administrador)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id              int primary key default 1 check (id = 1),
  min_amount      numeric(12,2) not null default 50,
  max_amount      numeric(12,2) not null default 5000,
  default_pct     numeric(5,2)  not null default 0.20,
  max_pct         numeric(5,2)  not null default 1.00,
  agent_share     numeric(5,4)  not null default 0.75,
  agent_minutes   int not null default 20,
  client_minutes  int not null default 60,
  strikes_max     int not null default 3,
  suspend_hours   int not null default 24,
  company_bank    text not null default 'BCP',
  company_account text not null default 'POR-CONFIGURAR',
  company_cci     text,
  company_holder  text not null default 'Agente Móvil Perú',
  updated_at      timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. ENTIDADES FINANCIERAS (y su estado: caída = relojes en pausa)
-- ---------------------------------------------------------------------
create table if not exists public.entities (
  name       text primary key,
  kind       text not null check (kind in ('banco','caja')),
  sort       int not null default 0,
  down       boolean not null default false,
  down_since timestamptz
);
insert into public.entities (name, kind, sort) values
  ('BCP','banco',1),('Interbank','banco',2),('BBVA','banco',3),('Scotiabank','banco',4),('Banco de la Nación','banco',5),
  ('Caja Arequipa','caja',10),('Caja Trujillo','caja',11),('Caja Piura','caja',12),('Caja Huancayo','caja',13),
  ('Caja Cusco','caja',14),('Caja Sullana','caja',15),('Caja Ica','caja',16),('Caja Tacna','caja',17),('Caja Maynas','caja',18)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 3. PERFILES
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  full_name        text not null default '',
  dni              text,
  phone            text,
  dept             text,
  role             text not null default 'usuario' check (role in ('usuario','soporte','admin')),
  kyc_status       text not null default 'pendiente' check (kyc_status in ('pendiente','en_revision','aprobado','rechazado')),
  kyc_note         text,
  dni_photo_path   text,
  selfie_path      text,
  agent_status     text not null default 'no' check (agent_status in ('no','solicitado','activo','retirado')),
  strikes          int not null default 0,
  suspended_until  timestamptz,
  banned           boolean not null default false,
  ban_reason       text,
  wallet           numeric(12,2) not null default 0 check (wallet >= 0),
  mismatch_reports int not null default 0,
  created_at       timestamptz not null default now()
);
-- El DNI queda reservado solo cuando soporte aprueba la identidad (así nadie bloquea el DNI de otra persona registrándose primero)
drop index if exists public.profiles_dni_key;
create unique index if not exists profiles_dni_approved_key on public.profiles(dni) where kyc_status = 'aprobado';

-- Lista negra biométrica (DNI + fotos del registro)
create table if not exists public.blacklist (
  id          bigint generated always as identity primary key,
  dni         text not null,
  full_name   text,
  reason      text not null,
  user_id     uuid,
  selfie_path text,
  created_at  timestamptz not null default now()
);
create index if not exists blacklist_dni_idx on public.blacklist(dni);

-- Crear el perfil cuando alguien se registra
create or replace function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dni text := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'dni',''),'\D','','g'),'');
        v_bl  public.blacklist;
begin
  select * into v_bl from public.blacklist where dni = v_dni limit 1;
  insert into public.profiles (id, email, full_name, dni, phone, dept, banned, ban_reason)
  values (new.id, new.email,
          coalesce(trim(new.raw_user_meta_data->>'full_name'),''),
          v_dni,
          new.raw_user_meta_data->>'phone',
          new.raw_user_meta_data->>'dept',
          v_bl.id is not null,
          case when v_bl.id is not null then 'DNI en lista negra: '||v_bl.reason end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('soporte','admin') and not banned);
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not banned);
$$;

-- ---------------------------------------------------------------------
-- 4. CUENTAS BANCARIAS (siempre a nombre del usuario)
-- ---------------------------------------------------------------------
create table if not exists public.bank_accounts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  entity      text not null references public.entities(name),
  number      text not null,
  holder      text not null,          -- copiado del perfil: nunca lo escribe el usuario
  active      boolean not null default true,
  flagged     text,                   -- motivo si un agente reportó que el titular no coincide
  created_at  timestamptz not null default now(),
  unique (user_id, entity, number)
);

-- ---------------------------------------------------------------------
-- 5. ÓRDENES
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id               bigint generated always as identity primary key,
  code             text generated always as ('OP-' || lpad(id::text, 5, '0')) stored,
  client_id        uuid not null references public.profiles(id),
  dest_account_id  bigint references public.bank_accounts(id),
  dest_entity      text not null references public.entities(name),
  dest_number      text not null,
  dest_holder      text not null,
  client_short     text not null,     -- "Luis C." para la lista pública
  client_dept      text,
  amount           numeric(12,2) not null check (amount > 0),
  pct              numeric(5,2)  not null,
  fee              numeric(12,2) not null,
  agent_fee        numeric(12,2) not null,
  platform_fee     numeric(12,2) not null,
  total            numeric(12,2) not null,
  funding          text not null check (funding in ('deposito','saldo')),
  status           text not null check (status in ('deposito_pendiente','deposito_revision','publicada','aceptada','confirmacion','revision','completada','reembolsada','cancelada','rechazada')),
  deposit_code     text,
  deposit_proof    text,
  agent_id         uuid references public.profiles(id),
  accepted_at      timestamptz,
  agent_deadline   timestamptz,
  voucher_code     text,
  voucher_path     text,
  voucher_at       timestamptz,
  client_deadline  timestamptz,
  not_arrived      int not null default 0,
  published_at     timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_client_idx on public.orders(client_id);
create index if not exists orders_agent_idx  on public.orders(agent_id);
-- Un agente solo puede tener una orden en curso
create unique index if not exists orders_one_active_per_agent on public.orders(agent_id) where status in ('aceptada');

create table if not exists public.order_events (
  id        bigint generated always as identity primary key,
  order_id  bigint not null references public.orders(id) on delete cascade,
  actor     uuid,
  text      text not null,
  at        timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id);

create table if not exists public.cases (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references public.orders(id),
  type         text not null check (type in ('inactividad','denuncia')),
  status       text not null default 'abierto' check (status in ('abierto','resuelto')),
  transfer_ok  boolean,
  resolution   text,
  resolved_by  uuid,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists cases_one_open_per_order on public.cases(order_id) where status = 'abierto';

-- ---------------------------------------------------------------------
-- 6. BILLETERA: libro de movimientos y retiros
-- ---------------------------------------------------------------------
create table if not exists public.wallet_ledger (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles(id),
  amount    numeric(12,2) not null,
  balance   numeric(12,2) not null,
  kind      text not null,
  order_id  bigint references public.orders(id),
  note      text,
  at        timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger(user_id);

create table if not exists public.withdrawals (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id),
  account_id  bigint not null references public.bank_accounts(id),
  entity      text not null,
  number      text not null,
  amount      numeric(12,2) not null check (amount > 0),
  status      text not null default 'pendiente' check (status in ('pendiente','pagado','rechazado')),
  paid_code   text,
  note        text,
  done_by     uuid,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

-- ---------------------------------------------------------------------
-- 7. NOTIFICACIONES
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text,
  order_id   bigint,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- =====================================================================
-- 8. FUNCIONES INTERNAS (no se pueden llamar desde la app)
-- =====================================================================
create or replace function app_private.cfg() returns public.settings
language sql stable security definer set search_path = public as $$ select * from public.settings where id = 1 $$;

create or replace function app_private.me() returns public.profiles
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Inicia sesión para continuar.'; end if;
  if p.banned then raise exception 'Tu cuenta está bloqueada: %', coalesce(p.ban_reason,'fraude'); end if;
  return p;
end $$;

create or replace function app_private.notify(p_user uuid, p_title text, p_body text, p_order bigint default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, order_id) values (p_user, p_title, p_body, p_order);
$$;

create or replace function app_private.notify_staff(p_title text, p_body text, p_order bigint default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, order_id)
  select id, p_title, p_body, p_order from public.profiles where role in ('soporte','admin') and not banned;
$$;

create or replace function app_private.ev(p_order bigint, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into public.order_events (order_id, actor, text) values (p_order, auth.uid(), p_text);
$$;

create or replace function app_private.money(n numeric) returns text
language sql immutable as $$ select 'S/ ' || to_char(n, 'FM999G999G990D00') $$;

-- Mueve saldo de la billetera virtual y deja constancia
create or replace function app_private.wallet_move(p_user uuid, p_amount numeric, p_kind text, p_order bigint, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  update public.profiles set wallet = wallet + p_amount where id = p_user returning wallet into v;
  if v is null then raise exception 'Usuario no encontrado'; end if;
  if v < 0 then raise exception 'Saldo insuficiente'; end if;
  insert into public.wallet_ledger (user_id, amount, balance, kind, order_id, note) values (p_user, p_amount, v, p_kind, p_order, p_note);
  return v;
end $$;

-- Libera el dinero al agente: monto + su parte de la comisión
create or replace function app_private.liquidate(p_order bigint, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.status not in ('confirmacion','revision') then raise exception 'La orden ya no se puede liquidar (%).', o.status; end if;
  perform app_private.wallet_move(o.agent_id, o.amount + o.agent_fee, 'liquidacion', o.id, o.code || ': monto + comisión');
  update public.orders set status = 'completada', closed_at = now() where id = o.id;
  perform app_private.ev(o.id, case p_by when 'cliente' then 'El cliente confirmó que el dinero llegó. Fondos liberados al agente.'
                                         else 'Soporte verificó la transferencia con la entidad y liberó los fondos al agente.' end);
  perform app_private.notify(o.agent_id, 'Ganaste ' || app_private.money(o.agent_fee),
          'Se acreditaron ' || app_private.money(o.amount + o.agent_fee) || ' en tu saldo por ' || o.code || '.', o.id);
  perform app_private.notify(o.client_id, o.code || ' completada', app_private.money(o.amount) || ' llegaron a tu cuenta ' || o.dest_entity || '.', o.id);
end $$;

-- Devuelve al cliente todo lo que depositó (monto + comisión) a su saldo virtual
create or replace function app_private.refund(p_order bigint, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.status not in ('publicada','aceptada','confirmacion','revision') then raise exception 'La orden no tiene fondos en custodia (%).', o.status; end if;
  perform app_private.wallet_move(o.client_id, o.total, 'devolucion', o.id, o.code || ': ' || p_why);
  update public.orders set status = 'reembolsada', closed_at = now() where id = o.id;
  perform app_private.ev(o.id, app_private.money(o.total) || ' devueltos al saldo virtual del cliente (' || p_why || ').');
  perform app_private.notify(o.client_id, 'Te devolvimos ' || app_private.money(o.total),
          'Está en tu saldo virtual. Puedes volver a publicar la orden sin depositar de nuevo. Motivo: ' || p_why || '.', o.id);
end $$;

create or replace function app_private.strike(p_agent uuid, p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c public.settings := app_private.cfg(); p public.profiles;
begin
  update public.profiles set strikes = strikes + 1 where id = p_agent returning * into p;
  if p.strikes >= c.strikes_max then
    update public.profiles set agent_status = 'retirado', suspended_until = null where id = p_agent;
    perform app_private.notify(p_agent, 'Perdiste el rol de agente',
      'Acumulaste ' || c.strikes_max || ' órdenes aceptadas sin transferir. Puedes seguir usando la app como cliente.', p_order);
  else
    update public.profiles set suspended_until = now() + make_interval(hours => c.suspend_hours) where id = p_agent;
    perform app_private.notify(p_agent, 'Strike ' || p.strikes || ' de ' || c.strikes_max,
      'No podrás tomar órdenes por ' || c.suspend_hours || ' horas.', p_order);
  end if;
end $$;

create or replace function app_private.ban(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  update public.profiles set banned = true, ban_reason = p_reason, agent_status = case when agent_status = 'no' then 'no' else 'retirado' end
   where id = p_user returning * into p;
  insert into public.blacklist (dni, full_name, reason, user_id, selfie_path)
  values (coalesce(p.dni,'sin-dni'), p.full_name, p_reason, p.id, p.selfie_path);
end $$;

create or replace function app_private.open_case(p_order bigint, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  update public.orders set status = 'revision' where id = p_order and status = 'confirmacion' returning * into o;
  if o.id is null then raise exception 'La orden no está esperando confirmación.'; end if;
  insert into public.cases (order_id, type) values (o.id, p_type);
  perform app_private.ev(o.id, case p_type when 'denuncia' then 'El cliente denunció el voucher como falso. Fondos congelados para auditoría.'
                                            else 'Pasaron los minutos de confirmación sin respuesta del cliente. Pasa a revisión manual.' end);
  perform app_private.notify_staff(case p_type when 'denuncia' then 'Denuncia de voucher falso' else 'Cliente sin respuesta' end,
          o.code || ' · ' || o.dest_entity || ' · ' || app_private.money(o.amount), o.id);
  perform app_private.notify(o.agent_id, o.code || ' en revisión', 'Soporte verificará tu código de operación con ' || o.dest_entity || '.', o.id);
  perform app_private.notify(o.client_id, o.code || ' en revisión', 'Soporte verificará la transferencia. Tu dinero sigue en custodia.', o.id);
end $$;

-- Relojes: agentes que no transfieren y clientes que no responden.
-- Lo ejecuta pg_cron cada minuto y también la app al abrirse.
create or replace function app_private.process_timeouts()
returns int language plpgsql security definer set search_path = public as $$
declare o public.orders; n int := 0;
begin
  for o in select x.* from public.orders x join public.entities e on e.name = x.dest_entity
            where x.status = 'aceptada' and x.agent_deadline < now() and not e.down
            for update of x skip locked loop
    perform app_private.ev(o.id, 'El agente no subió el voucher a tiempo. Se cancela su participación.');
    perform app_private.refund(o.id, 'el agente no transfirió a tiempo');
    perform app_private.strike(o.agent_id, o.id);
    n := n + 1;
  end loop;
  for o in select x.* from public.orders x join public.entities e on e.name = x.dest_entity
            where x.status = 'confirmacion' and x.client_deadline < now() and not e.down
            for update of x skip locked loop
    perform app_private.open_case(o.id, 'inactividad');
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- 9. FUNCIONES QUE USA LA APP (RPC)
-- =====================================================================
create or replace function public.server_now() returns timestamptz language sql stable as $$ select now() $$;

create or replace function public.tick() returns int
language sql security definer set search_path = public as $$ select app_private.process_timeouts() $$;

create or replace function public.update_my_profile(p_phone text, p_dept text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app_private.me();
  update public.profiles set phone = left(p_phone, 20), dept = left(p_dept, 40) where id = auth.uid();
end $$;

-- Registro de identidad: foto del DNI + selfie (revisión manual de soporte)
create or replace function public.submit_kyc(p_full_name text, p_dni text, p_dni_photo text, p_selfie text)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles := app_private.me(); v_dni text := regexp_replace(coalesce(p_dni,''),'\D','','g'); bl public.blacklist;
begin
  if p.kyc_status = 'aprobado' then raise exception 'Tu identidad ya está verificada.'; end if;
  if length(v_dni) <> 8 then raise exception 'El DNI debe tener 8 dígitos.'; end if;
  if length(trim(coalesce(p_full_name,''))) < 5 then raise exception 'Escribe tus nombres y apellidos completos, como en tu DNI.'; end if;
  if p_dni_photo is null or p_selfie is null then raise exception 'Sube la foto de tu DNI y tu selfie.'; end if;
  if p_dni_photo not like auth.uid()::text || '/%' or p_selfie not like auth.uid()::text || '/%' then raise exception 'Archivo no válido.'; end if;
  if exists (select 1 from public.profiles where dni = v_dni and id <> p.id and kyc_status in ('aprobado','en_revision'))
    then raise exception 'Ese DNI ya tiene una cuenta verificada o en revisión. Si no fuiste tú, escríbenos.'; end if;
  select * into bl from public.blacklist where dni = v_dni limit 1;
  if bl.id is not null then
    update public.profiles set banned = true, ban_reason = 'DNI en lista negra: ' || bl.reason, dni = v_dni where id = p.id;
    return 'bloqueado';
  end if;
  update public.profiles set full_name = trim(p_full_name), dni = v_dni, dni_photo_path = p_dni_photo, selfie_path = p_selfie,
         kyc_status = 'en_revision', kyc_note = null where id = p.id;
  perform app_private.notify_staff('Nueva verificación de identidad', trim(p_full_name) || ' · DNI ' || v_dni, null);
  return 'en_revision';
end $$;

create or replace function public.review_kyc(p_user uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  update public.profiles set kyc_status = case when p_ok then 'aprobado' else 'rechazado' end, kyc_note = p_note
   where id = p_user and kyc_status = 'en_revision';
  if not found then raise exception 'La verificación ya fue revisada.'; end if;
  update public.bank_accounts set holder = (select full_name from public.profiles where id = p_user) where user_id = p_user;
  perform app_private.notify(p_user, case when p_ok then 'Identidad verificada' else 'Verificación rechazada' end,
    case when p_ok then 'Ya puedes mover tu dinero en Agente Móvil.' else coalesce(p_note,'Vuelve a subir fotos claras de tu DNI y tu rostro.') end, null);
end $$;

create or replace function public.add_account(p_entity text, p_number text)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.profiles := app_private.me(); v_num text := regexp_replace(coalesce(p_number,''),'[^0-9-]','','g'); v_id bigint;
begin
  if length(regexp_replace(v_num,'\D','','g')) < 8 then raise exception 'Revisa el número de cuenta.'; end if;
  if not exists (select 1 from public.entities where name = p_entity) then raise exception 'Entidad no válida.'; end if;
  if (select count(*) from public.bank_accounts where user_id = p.id and active) >= 12 then raise exception 'Máximo 12 cuentas.'; end if;
  insert into public.bank_accounts (user_id, entity, number, holder) values (p.id, p_entity, v_num, p.full_name)
  on conflict (user_id, entity, number) do update set active = true returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_account(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app_private.me();
  if exists (select 1 from public.orders where dest_account_id = p_id and status in ('deposito_pendiente','deposito_revision','publicada','aceptada','confirmacion','revision'))
  then raise exception 'Esa cuenta tiene una orden en curso.'; end if;
  update public.bank_accounts set active = false where id = p_id and user_id = auth.uid();
end $$;

-- Crear una orden. Con 'deposito' espera el depósito BCP→BCP; con 'saldo' se publica al instante.
create or replace function public.create_order(p_dest_account bigint, p_amount numeric, p_pct numeric, p_funding text)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.profiles := app_private.me(); c public.settings := app_private.cfg(); a public.bank_accounts;
        v_fee numeric; v_agent numeric; v_total numeric; v_id bigint; v_short text;
begin
  if p.kyc_status <> 'aprobado' then raise exception 'Primero verificamos tu identidad.'; end if;
  if p_funding not in ('deposito','saldo') then raise exception 'Forma de pago no válida.'; end if;
  select * into a from public.bank_accounts where id = p_dest_account and user_id = p.id and active;
  if a.id is null then raise exception 'Elige una de tus cuentas registradas.'; end if;
  if a.flagged is not null then raise exception 'Esa cuenta está observada: %', a.flagged; end if;
  if p_amount is null or p_amount < c.min_amount then raise exception 'El monto mínimo es %.', app_private.money(c.min_amount); end if;
  if p_amount > c.max_amount then raise exception 'Por ahora el límite es % por operación.', app_private.money(c.max_amount); end if;
  if p_pct is null or p_pct < c.default_pct or p_pct > c.max_pct then raise exception '%', 'La comisión debe estar entre ' || c.default_pct || '% y ' || c.max_pct || '%.'; end if;
  if p_funding = 'deposito' then
    if c.company_account = 'POR-CONFIGURAR' then raise exception 'La empresa aún no configuró su cuenta recaudadora. Intenta más tarde.'; end if;
    if a.entity = c.company_bank then raise exception 'Tu depósito sale de tu cuenta %. Elige una cuenta destino en otra entidad.', c.company_bank; end if;
    if not exists (select 1 from public.bank_accounts where user_id = p.id and entity = c.company_bank and active)
      then raise exception 'Registra primero tu cuenta % a tu nombre: desde ahí haces el depósito.', c.company_bank; end if;
  end if;
  if (select count(*) from public.orders where client_id = p.id and status in ('deposito_pendiente','deposito_revision','publicada','aceptada','confirmacion','revision')) >= 3
    then raise exception 'Tienes 3 órdenes en curso. Espera a que terminen.'; end if;
  v_fee := round(p_amount * p_pct / 100, 2);
  v_agent := round(v_fee * c.agent_share, 2);
  v_total := p_amount + v_fee;
  v_short := split_part(p.full_name,' ',1) || ' ' || left(split_part(p.full_name,' ',2),1) || '.';
  insert into public.orders (client_id, dest_account_id, dest_entity, dest_number, dest_holder, client_short, client_dept,
                             amount, pct, fee, agent_fee, platform_fee, total, funding, status)
  values (p.id, a.id, a.entity, a.number, p.full_name, v_short, p.dept,
          p_amount, p_pct, v_fee, v_agent, v_fee - v_agent, v_total, p_funding,
          case when p_funding = 'saldo' then 'publicada' else 'deposito_pendiente' end)
  returning id into v_id;
  perform app_private.ev(v_id, 'Orden creada: ' || app_private.money(p_amount) || ' hacia ' || a.entity || ' con ' || p_pct || '% de comisión.');
  if p_funding = 'saldo' then
    perform app_private.wallet_move(p.id, -v_total, 'orden', v_id, 'Pago de orden con saldo');
    update public.orders set published_at = now() where id = v_id;
    perform app_private.ev(v_id, 'Pagada con saldo virtual. Fondos en custodia. Orden publicada a nivel nacional.');
    perform app_private.notify(x.id, 'Nueva orden: ' || app_private.money(p_amount) || ' a ' || a.entity, p_pct || '% de comisión', v_id)
       from public.profiles x where x.agent_status = 'activo' and not x.banned and x.id <> p.id
        and exists (select 1 from public.bank_accounts b where b.user_id = x.id and b.entity = a.entity and b.active);
  end if;
  return v_id;
end $$;

create or replace function public.submit_deposit(p_order bigint, p_code text, p_proof text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform app_private.me();
  if coalesce(p_code,'') !~ '^\d{6,12}$' then raise exception 'Escribe el código de operación (6 a 12 dígitos).'; end if;
  if p_proof is null or p_proof not like p_order::text || '/' || auth.uid()::text || '-%' then raise exception 'Sube la captura de tu transferencia.'; end if;
  update public.orders set status = 'deposito_revision', deposit_code = p_code, deposit_proof = p_proof
   where id = p_order and client_id = auth.uid() and status = 'deposito_pendiente' returning * into o;
  if o.id is null then raise exception 'Esta orden no espera un depósito.'; end if;
  perform app_private.ev(o.id, 'El cliente reportó su depósito BCP→BCP (código ' || p_code || '). Soporte lo valida.');
  perform app_private.notify_staff('Depósito por validar', o.code || ' · ' || app_private.money(o.total) || ' · código ' || p_code, o.id);
end $$;

-- Soporte confirma en la cuenta de la empresa que el depósito llegó y que el titular coincide
create or replace function public.review_deposit(p_order bigint, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  update public.orders set status = case when p_ok then 'publicada' else 'rechazada' end,
         published_at = case when p_ok then now() end, closed_at = case when p_ok then null else now() end
   where id = p_order and status = 'deposito_revision' returning * into o;
  if o.id is null then raise exception 'El depósito ya fue revisado.'; end if;
  if p_ok then
    perform app_private.ev(o.id, 'Depósito validado: llegó a la cuenta de la empresa y el titular coincide con el DNI. Orden publicada a nivel nacional.');
    perform app_private.notify(o.client_id, o.code || ' publicada', 'Validamos tu depósito. Ya estamos buscando un agente.', o.id);
    perform app_private.notify(x.id, 'Nueva orden: ' || app_private.money(o.amount) || ' a ' || o.dest_entity, o.pct || '% de comisión', o.id)
       from public.profiles x where x.agent_status = 'activo' and not x.banned and x.id <> o.client_id
        and exists (select 1 from public.bank_accounts b where b.user_id = x.id and b.entity = o.dest_entity and b.active);
  else
    perform app_private.ev(o.id, 'Depósito rechazado: ' || coalesce(p_note,'no se encontró o el titular no coincide') || '. Si llegó dinero, se devuelve a la cuenta de origen.');
    perform app_private.notify(o.client_id, 'Depósito rechazado', coalesce(p_note,'No encontramos tu depósito o el titular no coincide con tu DNI.'), o.id);
  end if;
end $$;

create or replace function public.cancel_order(p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform app_private.me();
  select * into o from public.orders where id = p_order and client_id = auth.uid() for update;
  if o.id is null then raise exception 'Orden no encontrada.'; end if;
  if o.status = 'deposito_pendiente' then
    update public.orders set status = 'cancelada', closed_at = now() where id = o.id;
    perform app_private.ev(o.id, 'El cliente canceló antes de depositar.');
  elsif o.status = 'publicada' then
    perform app_private.refund(o.id, 'cancelada por el cliente');
    update public.orders set status = 'cancelada' where id = o.id;
  else
    raise exception 'Ya no puedes cancelar: la orden está en curso.';
  end if;
end $$;

-- Mercado de órdenes para agentes (sin datos personales del cliente)
create or replace function public.list_market()
returns table (id bigint, code text, dest_entity text, amount numeric, pct numeric, agent_fee numeric,
               client_short text, client_dept text, published_at timestamptz, has_account boolean)
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles := app_private.me();
begin
  if p.agent_status <> 'activo' and not public.is_staff() then raise exception 'Solo agentes activos.'; end if;
  return query
    select o.id, o.code, o.dest_entity, o.amount, o.pct, o.agent_fee, o.client_short, o.client_dept, o.published_at,
           exists (select 1 from public.bank_accounts b where b.user_id = p.id and b.entity = o.dest_entity and b.active)
      from public.orders o
     where o.status = 'publicada' and o.client_id <> p.id
     order by o.pct desc, o.amount desc, o.published_at asc
     limit 200;
end $$;

create or replace function public.request_agent()
returns void language plpgsql security definer set search_path = public as $$
declare p public.profiles := app_private.me();
begin
  if p.kyc_status <> 'aprobado' then raise exception 'Primero verificamos tu identidad.'; end if;
  if p.agent_status = 'retirado' then raise exception 'Perdiste el rol de agente por strikes o fraude.'; end if;
  if p.agent_status in ('solicitado','activo') then return; end if;
  update public.profiles set agent_status = 'solicitado' where id = p.id;
  perform app_private.notify_staff('Solicitud para ser agente', p.full_name || ' · DNI ' || p.dni, null);
end $$;

create or replace function public.review_agent(p_user uuid, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  update public.profiles set agent_status = case when p_ok then 'activo' else 'no' end where id = p_user and agent_status = 'solicitado';
  if not found then raise exception 'La solicitud ya fue revisada.'; end if;
  perform app_private.notify(p_user, case when p_ok then 'Ya eres agente' else 'Solicitud de agente rechazada' end,
    case when p_ok then 'Entra a la pestaña Agente para ver las órdenes del Perú.' else 'Por ahora no podemos activarte como agente.' end, null);
end $$;

create or replace function public.accept_order(p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
declare p public.profiles := app_private.me(); c public.settings := app_private.cfg(); o public.orders;
begin
  perform app_private.process_timeouts();
  if p.agent_status <> 'activo' then raise exception 'Tu cuenta no está activa como agente.'; end if;
  if p.suspended_until > now() then raise exception 'Estás suspendido hasta %.', to_char(p.suspended_until at time zone 'America/Lima','DD/MM HH24:MI'); end if;
  if exists (select 1 from public.orders where agent_id = p.id and status = 'aceptada') then raise exception 'Termina tu orden en curso antes de tomar otra.'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status <> 'publicada' then raise exception 'Otro agente ya tomó esta orden.'; end if;
  if o.client_id = p.id then raise exception 'No puedes tomar tu propia orden.'; end if;
  if not exists (select 1 from public.bank_accounts where user_id = p.id and entity = o.dest_entity and active)
    then raise exception 'Necesitas una cuenta en % para tomar esta orden.', o.dest_entity; end if;
  update public.orders set status = 'aceptada', agent_id = p.id, accepted_at = now(),
         agent_deadline = now() + make_interval(mins => c.agent_minutes) where id = o.id;
  perform app_private.ev(o.id, p.full_name || ' aceptó la orden. Tiene ' || c.agent_minutes || ' minutos para transferir.');
  perform app_private.notify(o.client_id, 'Un agente tomó tu orden', 'Te avisaremos cuando transfiera a tu cuenta ' || o.dest_entity || '.', o.id);
end $$;

create or replace function public.submit_voucher(p_order bigint, p_code text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.settings := app_private.cfg(); o public.orders;
begin
  perform app_private.me();
  perform app_private.process_timeouts();
  if coalesce(p_code,'') !~ '^\d{6,12}$' then raise exception 'Escribe el código de operación (6 a 12 dígitos) tal como aparece en tu voucher.'; end if;
  if p_path is null or p_path not like p_order::text || '/' || auth.uid()::text || '-%' then raise exception 'Sube la captura del voucher.'; end if;
  update public.orders set status = 'confirmacion', voucher_code = p_code, voucher_path = p_path, voucher_at = now(),
         client_deadline = now() + make_interval(mins => c.client_minutes)
   where id = p_order and agent_id = auth.uid() and status = 'aceptada' returning * into o;
  if o.id is null then raise exception 'Esta orden ya no está a tu cargo.'; end if;
  perform app_private.ev(o.id, 'El agente subió el voucher (código ' || p_code || '). El cliente tiene ' || c.client_minutes || ' minutos para confirmar.');
  perform app_private.notify(o.client_id, '¿Te llegó ' || app_private.money(o.amount) || '?',
    'El agente reportó la transferencia a tu cuenta ' || o.dest_entity || '. Tienes ' || c.client_minutes || ' minutos para responder.', o.id);
end $$;

create or replace function public.agent_give_up(p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform app_private.me();
  select * into o from public.orders where id = p_order and agent_id = auth.uid() and status = 'aceptada' for update;
  if o.id is null then raise exception 'Esta orden ya no está a tu cargo.'; end if;
  perform app_private.ev(o.id, 'El agente indicó que no puede hacer la transferencia.');
  perform app_private.refund(o.id, 'el agente no pudo transferir');
  perform app_private.strike(o.agent_id, o.id);
end $$;

-- El agente ve en su banca que la cuenta destino NO está a nombre del cliente
create or replace function public.report_holder_mismatch(p_order bigint, p_seen text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform app_private.me();
  select * into o from public.orders where id = p_order and agent_id = auth.uid() and status = 'aceptada' for update;
  if o.id is null then raise exception 'Esta orden ya no está a tu cargo.'; end if;
  update public.bank_accounts set flagged = 'Titular reportado como "' || left(coalesce(p_seen,'?'),60) || '"' where id = o.dest_account_id;
  update public.profiles set mismatch_reports = mismatch_reports + 1 where id = o.agent_id;
  perform app_private.ev(o.id, 'El agente reportó que la cuenta destino figura a nombre de "' || left(coalesce(p_seen,'?'),60) || '". No se transfirió.');
  perform app_private.refund(o.id, 'la cuenta destino no está a tu nombre');
  perform app_private.notify_staff('Titular no coincide', o.code || ' · cuenta ' || o.dest_entity || ' ' || o.dest_number, o.id);
end $$;

create or replace function public.client_confirm(p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app_private.me();
  if not exists (select 1 from public.orders where id = p_order and client_id = auth.uid() and status = 'confirmacion')
    then raise exception 'Esta orden no espera tu confirmación.'; end if;
  perform app_private.liquidate(p_order, 'cliente');
end $$;

create or replace function public.client_not_yet(p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform app_private.me();
  update public.orders set not_arrived = not_arrived + 1 where id = p_order and client_id = auth.uid() and status = 'confirmacion' returning * into o;
  if o.id is null then raise exception 'Esta orden no espera tu confirmación.'; end if;
  perform app_private.ev(o.id, 'El cliente marcó "Aún no llega". El reloj sigue corriendo.');
  perform app_private.notify(o.agent_id, 'El cliente aún no ve el dinero', o.code || ': revisa que tu transferencia salió bien.', o.id);
end $$;

create or replace function public.client_report_fake(p_order bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app_private.me();
  if not exists (select 1 from public.orders where id = p_order and client_id = auth.uid() and status = 'confirmacion')
    then raise exception 'Esta orden no espera tu confirmación.'; end if;
  perform app_private.open_case(p_order, 'denuncia');
end $$;

-- Soporte decide un caso después de consultar el código con la entidad
create or replace function public.resolve_case(p_case bigint, p_transfer_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare k public.cases; o public.orders;
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  select * into k from public.cases where id = p_case and status = 'abierto' for update;
  if k.id is null then raise exception 'El caso ya fue resuelto.'; end if;
  select * into o from public.orders where id = k.order_id;
  if p_transfer_ok then
    perform app_private.liquidate(o.id, 'soporte');
    if k.type = 'denuncia' then
      perform app_private.ban(o.client_id, 'Denunció como falso un voucher real (' || o.code || ')');
      perform app_private.ev(o.id, 'El cliente fue bloqueado por denunciar un voucher real.');
    end if;
  else
    perform app_private.refund(o.id, 'voucher adulterado');
    perform app_private.ban(o.agent_id, 'Subió un voucher adulterado (' || o.code || ')');
    perform app_private.ev(o.id, 'El agente fue bloqueado y añadido a la lista negra por voucher adulterado.');
  end if;
  update public.cases set status = 'resuelto', transfer_ok = p_transfer_ok, resolution = p_note, resolved_by = auth.uid(), resolved_at = now() where id = k.id;
end $$;

create or replace function public.request_withdrawal(p_account bigint, p_amount numeric)
returns bigint language plpgsql security definer set search_path = public as $$
declare p public.profiles := app_private.me(); a public.bank_accounts; v_id bigint;
begin
  select * into a from public.bank_accounts where id = p_account and user_id = p.id and active and flagged is null;
  if a.id is null then raise exception 'Elige una de tus cuentas.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Monto no válido.'; end if;
  if p_amount > p.wallet then raise exception 'Tu saldo es %.', app_private.money(p.wallet); end if;
  insert into public.withdrawals (user_id, account_id, entity, number, amount) values (p.id, a.id, a.entity, a.number, p_amount) returning id into v_id;
  perform app_private.wallet_move(p.id, -p_amount, 'retiro', null, 'Retiro a ' || a.entity || ' ' || a.number);
  perform app_private.notify_staff('Retiro por pagar', p.full_name || ' · ' || app_private.money(p_amount) || ' a ' || a.entity, null);
  return v_id;
end $$;

create or replace function public.resolve_withdrawal(p_id bigint, p_paid boolean, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare w public.withdrawals;
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  update public.withdrawals set status = case when p_paid then 'pagado' else 'rechazado' end, paid_code = p_code, done_by = auth.uid(), done_at = now()
   where id = p_id and status = 'pendiente' returning * into w;
  if w.id is null then raise exception 'El retiro ya fue procesado.'; end if;
  if p_paid then
    perform app_private.notify(w.user_id, 'Retiro pagado', app_private.money(w.amount) || ' enviados a tu ' || w.entity || '. Operación ' || coalesce(p_code,'-') || '.', null);
  else
    perform app_private.wallet_move(w.user_id, w.amount, 'retiro_devuelto', null, 'Retiro rechazado: ' || coalesce(p_code,''));
    perform app_private.notify(w.user_id, 'Retiro rechazado', 'Devolvimos ' || app_private.money(w.amount) || ' a tu saldo. ' || coalesce(p_code,''), null);
  end if;
end $$;

-- Caída de una entidad: pausa los relojes; al volver, se suma el tiempo perdido
create or replace function public.set_entity_down(p_entity text, p_down boolean)
returns void language plpgsql security definer set search_path = public as $$
declare e public.entities; lost interval;
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  select * into e from public.entities where name = p_entity for update;
  if e.name is null or e.down = p_down then return; end if;
  if p_down then
    update public.entities set down = true, down_since = now() where name = p_entity;
  else
    lost := now() - e.down_since;
    update public.orders set agent_deadline = agent_deadline + lost where dest_entity = p_entity and status = 'aceptada';
    update public.orders set client_deadline = client_deadline + lost where dest_entity = p_entity and status = 'confirmacion';
    update public.entities set down = false, down_since = null where name = p_entity;
  end if;
end $$;

create or replace function public.staff_lift_suspension(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  update public.profiles set suspended_until = null where id = p_user;
end $$;

create or replace function public.admin_set_role(p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador.'; end if;
  update public.profiles set role = p_role where lower(email) = lower(p_email);
  if not found then raise exception 'No existe un usuario con ese correo.'; end if;
end $$;

-- Cuadre del dinero: lo que debe haber en la cuenta de la empresa
create or replace function public.admin_summary()
returns table (custody numeric, wallets numeric, withdrawals_pending numeric, platform_earned numeric,
               orders_completed bigint, open_cases bigint, deposits_to_check bigint)
language sql stable security definer set search_path = public as $$
  select
    (select coalesce(sum(total),0) from public.orders where status in ('publicada','aceptada','confirmacion','revision')),
    (select coalesce(sum(wallet),0) from public.profiles),
    (select coalesce(sum(amount),0) from public.withdrawals where status = 'pendiente'),
    (select coalesce(sum(platform_fee),0) from public.orders where status = 'completada'),
    (select count(*) from public.orders where status = 'completada'),
    (select count(*) from public.cases where status = 'abierto'),
    (select count(*) from public.orders where status = 'deposito_revision')
  where public.is_staff();
$$;


-- ---------------------------------------------------------------------
-- 9b. LIBRO DE RECLAMACIONES VIRTUAL (obligatorio si tienes web)
-- ---------------------------------------------------------------------
create table if not exists public.complaints (
  id           bigint generated always as identity primary key,
  code         text,
  kind         text not null check (kind in ('reclamo','queja')),
  full_name    text not null,
  doc          text not null,
  address      text,
  phone        text,
  email        text not null,
  amount       numeric(12,2),
  service      text not null,
  detail       text not null,
  request      text not null,
  status       text not null default 'recibido' check (status in ('recibido','respondido')),
  answer       text,
  answered_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.complaints enable row level security;
drop policy if exists complaints_staff on public.complaints;
create policy complaints_staff on public.complaints for select to authenticated using (public.is_staff());

create or replace function public.submit_complaint(p_kind text, p_full_name text, p_doc text, p_address text, p_phone text, p_email text,
                                                   p_amount numeric, p_service text, p_detail text, p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.complaints;
begin
  if p_kind not in ('reclamo','queja') then raise exception 'Elige reclamo o queja.'; end if;
  if length(trim(coalesce(p_full_name,''))) < 5 or length(coalesce(p_doc,'')) < 8 or coalesce(p_email,'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(trim(coalesce(p_detail,''))) < 10 or length(trim(coalesce(p_request,''))) < 3 or length(trim(coalesce(p_service,''))) < 3
    then raise exception 'Completa todos los campos obligatorios.'; end if;
  insert into public.complaints (kind, full_name, doc, address, phone, email, amount, service, detail, request)
  values (p_kind, left(trim(p_full_name),120), left(p_doc,20), left(p_address,200), left(p_phone,20), left(p_email,120), p_amount,
          left(p_service,200), left(p_detail,3000), left(p_request,1000)) returning * into v;
  update public.complaints set code = 'R-' || to_char(now() at time zone 'America/Lima','YYYY') || '-' || lpad(v.id::text, 5, '0')
   where id = v.id returning * into v;
  perform app_private.notify_staff('Nuevo ' || p_kind || ' en el Libro de Reclamaciones', v.code || ' · ' || v.full_name, null);
  return v.code;
end $$;

create or replace function public.answer_complaint(p_id bigint, p_answer text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Solo soporte.'; end if;
  update public.complaints set status = 'respondido', answer = p_answer, answered_at = now() where id = p_id;
end $$;
revoke execute on function public.submit_complaint(text,text,text,text,text,text,numeric,text,text,text) from public;
grant execute on function public.submit_complaint(text,text,text,text,text,text,numeric,text,text,text) to anon, authenticated;
revoke execute on function public.answer_complaint(bigint,text) from public, anon;
grant execute on function public.answer_complaint(bigint,text) to authenticated;
grant select on public.complaints to authenticated;

-- =====================================================================
-- 10. SEGURIDAD POR FILAS (RLS): cada quien ve solo lo suyo
-- =====================================================================
alter table public.settings      enable row level security;
alter table public.entities      enable row level security;
alter table public.profiles      enable row level security;
alter table public.blacklist     enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.orders        enable row level security;
alter table public.order_events  enable row level security;
alter table public.cases         enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.withdrawals   enable row level security;
alter table public.notifications enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists entities_read on public.entities;
create policy entities_read on public.entities for select to authenticated using (true);

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());

drop policy if exists blacklist_staff on public.blacklist;
create policy blacklist_staff on public.blacklist for select to authenticated using (public.is_staff());

drop policy if exists accounts_read on public.bank_accounts;
create policy accounts_read on public.bank_accounts for select to authenticated using (user_id = auth.uid() or public.is_staff());

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (client_id = auth.uid() or agent_id = auth.uid() or public.is_staff());

drop policy if exists events_read on public.order_events;
create policy events_read on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.client_id = auth.uid() or o.agent_id = auth.uid())) or public.is_staff());

drop policy if exists cases_read on public.cases;
create policy cases_read on public.cases for select to authenticated using (public.is_staff());

drop policy if exists ledger_read on public.wallet_ledger;
create policy ledger_read on public.wallet_ledger for select to authenticated using (user_id = auth.uid() or public.is_staff());

drop policy if exists wd_read on public.withdrawals;
create policy wd_read on public.withdrawals for select to authenticated using (user_id = auth.uid() or public.is_staff());

drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_mark on public.notifications;
create policy notif_mark on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Permisos de tabla: la app solo lee; escribe a través de las funciones
revoke all on all tables in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant update (read) on public.notifications to authenticated;
grant update (min_amount, max_amount, default_pct, max_pct, agent_share, agent_minutes, client_minutes, strikes_max,
              suspend_hours, company_bank, company_account, company_cci, company_holder, updated_at) on public.settings to authenticated;

-- Las funciones públicas solo para usuarios con sesión
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
-- El Libro de Reclamaciones se puede usar sin cuenta
grant execute on function public.submit_complaint(text,text,text,text,text,text,numeric,text,text,text) to anon;

-- =====================================================================
-- 11. ARCHIVOS PRIVADOS (capturas y fotos de identidad)
--   kyc/<usuario>/...            : DNI y selfie. Solo el dueño y soporte.
--   comprobantes/<orden>/<usuario>-... : depósitos y vouchers. Solo las partes de la orden y soporte.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc','kyc',false, 5242880, array['image/jpeg','image/png','image/webp']),
       ('comprobantes','comprobantes',false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists kyc_insert on storage.objects;
create policy kyc_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists kyc_read on storage.objects;
create policy kyc_read on storage.objects for select to authenticated
  using (bucket_id = 'kyc' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));

create or replace function public.can_upload_proof(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
     where o.id::text = split_part(p_name,'/',1)
       and split_part(p_name,'/',2) like auth.uid()::text || '-%'
       and ((o.client_id = auth.uid() and o.status = 'deposito_pendiente')
         or (o.agent_id  = auth.uid() and o.status = 'aceptada')));
$$;
create or replace function public.can_read_proof(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.orders o
     where o.id::text = split_part(p_name,'/',1) and (o.client_id = auth.uid() or o.agent_id = auth.uid()));
$$;
grant execute on function public.can_upload_proof(text), public.can_read_proof(text) to authenticated;

drop policy if exists proof_insert on storage.objects;
create policy proof_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.can_upload_proof(name));
drop policy if exists proof_read on storage.objects;
create policy proof_read on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.can_read_proof(name));

-- =====================================================================
-- 12. TIEMPO REAL Y RELOJ AUTOMÁTICO
-- =====================================================================
do $$ begin
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table public.orders;        exception when others then null; end;
end $$;

-- pg_cron revisa los relojes cada minuto. Si falla, actívalo en Database > Extensions > pg_cron y vuelve a ejecutar.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'amp-relojes';
  perform cron.schedule('amp-relojes', '* * * * *', 'select app_private.process_timeouts()');
exception when others then
  raise notice 'pg_cron no disponible (%). La app igual revisa los relojes cada vez que alguien la usa.', sqlerrm;
end $$;
