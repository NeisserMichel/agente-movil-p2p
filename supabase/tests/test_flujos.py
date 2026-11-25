"""Pruebas de los flujos de dinero de schema.sql contra un Postgres local.
Uso: python3 test_flujos.py  (requiere la base 't' con stubs.sql + schema.sql cargados)"""
import psycopg2, psycopg2.extras, uuid, sys
psycopg2.extras.register_uuid()
from decimal import Decimal as D

cx = psycopg2.connect(host='/tmp/pg', port=5544, user='postgres', dbname='t')
cx.autocommit = True
ok_n = 0

def q(sql, args=(), who=None):
    cur = cx.cursor()
    if who:
        cur.execute("set role authenticated; select set_config('request.jwt.claim.sub', %s, false)", (str(who),))
    else:
        cur.execute("reset role; select set_config('request.jwt.claim.sub', '', false)")
    try:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None
    finally:
        cur.execute("reset role")

def one(sql, args=(), who=None):
    r = q(sql, args, who); return r[0][0] if r else None

def fails(sql, args=(), who=None, contains=''):
    global ok_n
    try:
        q(sql, args, who)
    except Exception as e:
        msg = str(e).split('\n')[0]
        assert contains in msg, f'esperaba "{contains}" y vino: {msg}'
        ok_n += 1; return msg
    raise AssertionError('debía fallar: ' + sql)

def eq(a, b, what):
    global ok_n
    assert a == b, f'{what}: {a!r} != {b!r}'; ok_n += 1

def user(email, name, dni, dept='Lima', rol='cliente'):
    uid = uuid.uuid4()
    q("insert into auth.users (id,email,raw_user_meta_data) values (%s,%s,json_build_object('full_name',%s::text,'dni',%s::text,'dept',%s::text,'phone','999','rol',%s::text))",
      (str(uid), email, name, dni, dept, rol))
    return uid

def kyc(uid, name, dni):
    one("select public.submit_kyc(%s,%s,%s,%s)", (name, dni, f'{uid}/dni.jpg', f'{uid}/selfie.jpg'), uid)

def upload(uid, order, bucket='comprobantes'):
    name = f'{order}/{uid}-1.jpg'
    q("insert into storage.objects (bucket_id,name) values (%s,%s)", (bucket, name), uid)
    return name

def st(o): return one("select status from public.orders where id=%s", (o,))
def wal(u): return one("select wallet from public.profiles where id=%s", (u,))

# ---------- usuarios ----------
q("insert into public.blacklist (dni, full_name, reason) values ('40112233','Marco Rivas','Voucher adulterado')")
ADM = user('admin@x.pe', 'Neisser Calla Delgado', '11111111')
C   = user('luis@x.pe', 'Luis Chávez Ramos', '45871203', 'Cajamarca')
G   = user('carmen@x.pe', 'Carmen Huamán Torres', '41290578', 'Arequipa')
H   = user('pedro@x.pe', 'Pedro Vargas Ruiz', '42223333', 'Piura')
X   = user('malo@x.pe', 'Marco Rivas', '40112233')
q("update public.profiles set role='admin', kyc_status='aprobado' where id=%s", (ADM,))
eq(one("select banned from public.profiles where id=%s", (X,)), True, 'DNI en lista negra queda bloqueado al registrarse')
fails("select public.add_account('BCP','12345678')", who=X, contains='bloqueada')

# ---------- identidad ----------
fails("select public.create_order(1, 100, 0.2, 'deposito')", who=C, contains='identidad')
for u, n, d in [(C,'Luis Chávez Ramos','45871203'), (G,'Carmen Huamán Torres','41290578'), (H,'Pedro Vargas Ruiz','42223333')]:
    kyc(u, n, d)
fails("select public.review_kyc(%s,true,null)", (str(C),), who=G, contains='Solo soporte')
for u in (C, G, H): one("select public.review_kyc(%s,true,null)", (str(u),), ADM)
eq(one("select kyc_status from public.profiles where id=%s", (C,)), 'aprobado', 'KYC aprobado')

# ---------- cuentas ----------
c_bcp = one("select public.add_account('BCP','245-1877-4410')", who=C)
c_ct  = one("select public.add_account('Caja Trujillo','0071-3302-781')", who=C)
g_ct  = one("select public.add_account('Caja Trujillo','0033-1290-417')", who=G)
g_bcp = one("select public.add_account('BCP','215-4410-9928')", who=G)
h_ct  = one("select public.add_account('Caja Trujillo','0099-1111-222')", who=H)
eq(one("select holder from public.bank_accounts where id=%s", (c_ct,)), 'Luis Chávez Ramos', 'titular sale del perfil')
fails("select public.create_order(%s, 1000, 0.2, 'deposito')", (c_ct,), C, 'cuenta recaudadora')
q("update public.settings set company_account='193-2458871-0-41'")
fails("select public.create_order(%s, 100, 0.2, 'deposito')", (c_bcp,), C, 'otra entidad')
fails("select public.create_order(%s, 6000, 0.2, 'deposito')", (c_ct,), C, 'límite')
fails("select public.create_order(%s, 1000, 0.1, 'deposito')", (c_ct,), C, 'comisión')
fails("select public.create_order(%s, 1000, 0.2, 'deposito')", (g_ct,), C, 'tus cuentas')

# ---------- agentes ----------
eq(q("select count(*) from public.list_market()", who=G)[0][0], 0, 'cualquier usuario puede ver el mercado (vacío)')
for u in (G, H): one("select public.request_agent()", who=u); one("select public.review_agent(%s,true)", (str(u),), ADM)

# ---------- 1. flujo feliz ----------
o1 = one("select public.create_order(%s, 3000, 0.5, 'deposito')", (c_ct,), C)
eq(st(o1), 'deposito_pendiente', 'orden espera depósito')
fails("insert into storage.objects (bucket_id,name) values ('comprobantes', %s)", (f'{o1}/{G}-1.jpg',), G, 'row-level security')
p1 = upload(C, o1)
fails("select public.submit_deposit(%s,'12',%s)", (o1, p1), C, 'código')
one("select public.submit_deposit(%s,'06128833',%s)", (o1, p1), C)
eq(st(o1), 'deposito_revision', 'depósito en revisión')
eq(len(q("select * from public.list_market()", who=G)), 0, 'no publicada antes de validar')
one("select public.review_deposit(%s,true,null)", (o1,), ADM)
m = q("select id, amount, agent_fee, has_account from public.list_market()", who=G)
eq((m[0][0], m[0][1], m[0][2], m[0][3]), (o1, D('3000.00'), D('11.25'), True), 'mercado muestra la orden con ganancia del agente')
eq(q("select is_mine from public.list_market() where id=%s", (o1,), C)[0][0], True, 'el cliente ve su propia orden publicada')
# agente que se registró como agente pero aún no está verificado: ve la orden, no puede aceptarla
NV = user('nuevo@x.pe', 'Nuevo Agente Tres', '43334444', 'Lima', 'agente')
eq(one("select agent_status from public.profiles where id=%s", (NV,)), 'solicitado', 'registro como agente queda solicitado')
eq(len(q("select * from public.list_market()", who=NV)), 1, 'usuario sin verificar ve las órdenes publicadas')
fails("select public.accept_order(%s)", (o1,), NV, 'verificamos tu identidad')
fails("select public.review_agent(%s,true)", (str(NV),), ADM, 'confirma la identidad')
one("select public.review_kyc(%s,true,'Verificado por videollamada')", (str(NV),), ADM)
eq(one("select agent_status||'/'||kyc_status from public.profiles where id=%s", (NV,)), 'activo/aprobado', 'confirmar verificación activa al agente aunque no haya subido fotos')
fails("select public.accept_order(%s)", (o1,), NV, 'cuenta en Caja Trujillo')
fails("select public.accept_order(%s)", (o1,), C, 'agente')
eq(len(q("select dest_number from public.orders where id=%s", (o1,), G)), 0, 'agente no ve la cuenta antes de aceptar')
one("select public.accept_order(%s)", (o1,), G)
fails("select public.accept_order(%s)", (o1,), H, 'Otro agente')
eq(q("select dest_number, dest_holder from public.orders where id=%s", (o1,), G)[0], ('0071-3302-781', 'Luis Chávez Ramos'), 'agente ve la cuenta y el titular')
eq(len(q("select * from public.orders where id=%s", (o1,), H)), 0, 'otro agente no ve la orden')
v1 = upload(G, o1)
fails("select public.client_confirm(%s)", (o1,), C, 'no espera')
one("select public.submit_voucher(%s,'778812',%s)", (o1, v1), G)
eq(one("select public.can_read_proof(%s)", (v1,), C), True, 'cliente puede ver el voucher')
eq(one("select public.can_read_proof(%s)", (v1,), H), False, 'otro agente no ve el voucher')
one("select public.client_not_yet(%s)", (o1,), C)
one("select public.client_confirm(%s)", (o1,), C)
eq(st(o1), 'completada', 'orden completada')
eq(wal(G), D('3011.25'), 'agente recibe monto + 75% de comisión')
eq(one("select platform_earned from public.admin_summary()", who=ADM), D('3.75'), 'plataforma gana 25%')

# ---------- seguridad directa ----------
fails("update public.profiles set wallet = 99999 where id=%s", (str(G),), G, 'permission denied')
fails("select app_private.wallet_move(%s, 100, 'x', null, 'x')", (str(G),), G, 'permission denied')
fails("insert into public.orders (client_id) values (%s)", (str(C),), C, 'permission denied')
eq(len(q("select * from public.profiles", who=C)), 1, 'cliente solo ve su perfil')
eq(len(q("select * from public.cases", who=C)), 0, 'cliente no ve casos')

# ---------- 2. agente no transfiere: strike y devolución ----------
o2 = one("select public.create_order(%s, 1000, 0.2, 'deposito')", (c_ct,), C)
one("select public.submit_deposit(%s,'123456',%s)", (o2, upload(C, o2)), C)
one("select public.review_deposit(%s,true,null)", (o2,), ADM)
one("select public.accept_order(%s)", (o2,), G)
q("update public.orders set agent_deadline = now() - interval '1 min' where id=%s", (o2,))
eq(one("select public.tick()", who=C), 1, 'reloj procesa 1 orden')
eq(st(o2), 'reembolsada', 'orden devuelta')
eq(wal(C), D('1002.00'), 'cliente recibe monto + comisión en su saldo')
eq(one("select strikes from public.profiles where id=%s", (G,)), 1, 'strike 1')
fails("select public.accept_order(1)", who=G, contains='suspendido')

# ---------- 3. volver a publicar con saldo; voucher falso; soporte banea al agente ----------
o3 = one("select public.create_order(%s, 1000, 0.2, 'saldo')", (c_ct,), C)
eq((st(o3), wal(C)), ('publicada', D('0.00')), 'publicada con saldo y saldo descontado')
one("select public.accept_order(%s)", (o3,), H)
one("select public.submit_voucher(%s,'111222',%s)", (o3, upload(H, o3)), H)
one("select public.client_report_fake(%s)", (o3,), C)
eq(st(o3), 'revision', 'denuncia congela la orden')
k3 = one("select id from public.cases where order_id=%s", (o3,), ADM)
one("select public.resolve_case(%s,false,'BCP: código no existe')", (k3,), ADM)
eq((st(o3), wal(C)), ('reembolsada', D('1002.00')), 'cliente recupera su dinero')
eq(one("select banned from public.profiles where id=%s", (H,)), True, 'agente tramposo bloqueado')
eq(one("select count(*) from public.blacklist where dni='42223333'"), 1, 'agente en lista negra')
fails("select public.resolve_case(%s,true,null)", (k3,), ADM, 'ya fue resuelto')

# ---------- 4. cliente no responde: soporte verifica y libera ----------
one("select public.staff_lift_suspension(%s)", (str(G),), ADM)
o4 = one("select public.create_order(%s, 1000, 0.2, 'saldo')", (c_ct,), C)
one("select public.accept_order(%s)", (o4,), G)
one("select public.submit_voucher(%s,'555666',%s)", (o4, upload(G, o4)), G)
q("update public.orders set client_deadline = now() - interval '1 min' where id=%s", (o4,))
one("select public.tick()", who=G)
eq(one("select type from public.cases where order_id=%s", (o4,), ADM), 'inactividad', 'caso por inactividad')
one("select public.resolve_case((select id from public.cases where order_id=%s),true,'Caja Trujillo confirma')", (o4,), ADM)
eq((st(o4), wal(G)), ('completada', D('4012.75')), 'agente cobra tras verificación')
eq(one("select banned from public.profiles where id=%s", (C,)), False, 'cliente inactivo no se banea')

# ---------- 5. caída de entidad pausa los relojes ----------
cur_dl = None
o5 = one("select public.create_order(%s, 500, 0.2, 'deposito')", (c_ct,), C)
one("select public.submit_deposit(%s,'777888',%s)", (o5, upload(C, o5)), C)
one("select public.review_deposit(%s,true,null)", (o5,), ADM)
one("select public.accept_order(%s)", (o5,), G)
one("select public.set_entity_down('Caja Trujillo', true)", who=ADM)
q("update public.orders set agent_deadline = now() - interval '1 min' where id=%s", (o5,))
one("select public.tick()", who=C)
eq(st(o5), 'aceptada', 'reloj en pausa con la entidad caída')
q("update public.entities set down_since = now() - interval '10 min' where name='Caja Trujillo'")
one("select public.set_entity_down('Caja Trujillo', false)", who=ADM)
eq(one("select agent_deadline > now() from public.orders where id=%s", (o5,)), True, 'al volver se devuelve el tiempo perdido')

# ---------- 6. titular no coincide ----------
one("select public.report_holder_mismatch(%s,'Rosa Pérez')", (o5,), G)
eq((st(o5), wal(C)), ('reembolsada', D('501.00')), 'devuelto sin strike')
eq(one("select strikes from public.profiles where id=%s", (G,)), 1, 'sin strike por reportar titular')
fails("select public.create_order(%s, 500, 0.2, 'saldo')", (c_ct,), C, 'observada')

# ---------- 7. retiros ----------
fails("select public.request_withdrawal(%s, 99999)", (g_bcp,), G, 'saldo')
w = one("select public.request_withdrawal(%s, 4000)", (g_bcp,), G)
eq(wal(G), D('12.75'), 'retiro descuenta el saldo')
one("select public.resolve_withdrawal(%s,true,'0099887766')", (w,), ADM)
w2 = one("select public.request_withdrawal(%s, 12.75)", (g_bcp,), G)
one("select public.resolve_withdrawal(%s,false,'cuenta cerrada')", (w2,), ADM)
eq(wal(G), D('12.75'), 'retiro rechazado vuelve al saldo')

# ---------- 8. denuncia falsa: el cliente es bloqueado ----------
c2_ct = one("select public.add_account('Caja Trujillo','0071-3302-999')", who=C)
o8 = one("select public.create_order(%s, 400, 0.2, 'saldo')", (c2_ct,), C)
one("select public.accept_order(%s)", (o8,), G)
one("select public.submit_voucher(%s,'444555',%s)", (o8, upload(G, o8)), G)
one("select public.client_report_fake(%s)", (o8,), C)
one("select public.resolve_case((select id from public.cases where order_id=%s),true,'El dinero sí llegó')", (o8,), ADM)
eq(one("select banned from public.profiles where id=%s", (C,)), True, 'cliente que mintió bloqueado')
fails("select public.create_order(%s, 100, 0.2, 'saldo')", (c_ct,), C, 'bloqueada')

# ---------- 9. depósito rechazado (titular de otra persona) ----------
Z = user('ana@x.pe', 'Ana Mendoza Flores', '47778888')
kyc(Z, 'Ana Mendoza Flores', '47778888'); one("select public.review_kyc(%s,true,null)", (str(Z),), ADM)
one("select public.add_account('BCP','111-22222-333')", who=Z)
z_ip = one("select public.add_account('Interbank','898-1234-5678')", who=Z)
o9 = one("select public.create_order(%s, 800, 0.2, 'deposito')", (z_ip,), Z)
one("select public.submit_deposit(%s,'999000',%s)", (o9, upload(Z, o9)), Z)
one("select public.review_deposit(%s,false,'El depósito vino de una cuenta de otro titular')", (o9,), ADM)
eq(st(o9), 'rechazada', 'depósito de tercero rechazado')
fails("select public.submit_kyc('Otra Persona Ya','47778888',%s,%s)", (f'{G}/a.jpg', f'{G}/b.jpg'), G, 'ya está verificada')

# ---------- nadie puede apropiarse del DNI de otra persona ----------
SQ = user('impostor@x.pe', 'Impostor Falso Uno', '48889999')
kyc(SQ, 'Impostor Falso Uno', '48889999')
REAL = user('real@x.pe', 'Persona Real Dos', '48889999')
eq(one("select count(*) from public.profiles where dni='48889999'"), 2, 'el DNI ocupado no impide registrarse al verdadero dueño')
fails("select public.submit_kyc('Persona Real Dos','48889999',%s,%s)", (f'{REAL}/a.jpg', f'{REAL}/b.jpg'), REAL, 'en revisión')
one("select public.review_kyc(%s,false,'La selfie no coincide con el DNI')", (str(SQ),), ADM)
kyc(REAL, 'Persona Real Dos', '48889999'); one("select public.review_kyc(%s,true,null)", (str(REAL),), ADM)
eq(one("select kyc_status from public.profiles where id=%s", (REAL,)), 'aprobado', 'el verdadero dueño se verifica tras rechazar al impostor')
fails("select public.submit_kyc('Impostor Falso Uno','48889999',%s,%s)", (f'{SQ}/a.jpg', f'{SQ}/b.jpg'), SQ, 'verificada')

# ---------- visitante sin cuenta (anon) ----------
def anon(sql_, args=()):
    cur = cx.cursor(); cur.execute("set role anon")
    try: cur.execute(sql_, args); return cur.fetchall() if cur.description else None
    finally: cur.execute("reset role")
code = anon("select public.submit_complaint('reclamo','Rosa Quispe Mamani','45556677','Av. Lima 123','987654321','rosa@x.pe',100,'Transferencia OP-00001','El dinero no llegó a tiempo','Devolución')")[0][0]
eq(code.startswith('R-'), True, 'visitante puede dejar un reclamo')
for bad in ["select public.tick()", "select * from public.complaints", "select * from public.orders", "select public.create_order(1,100,0.2,'saldo')"]:
    try: anon(bad); raise AssertionError('anon no debía poder: ' + bad)
    except psycopg2.Error: ok_n += 1
eq(len(q("select * from public.complaints", who=ADM)), 1, 'soporte ve los reclamos')
eq(len(q("select * from public.complaints", who=G)), 0, 'usuario no ve reclamos ajenos')

# ---------- cuadre total del dinero ----------
ins = one("select coalesce(sum(total),0) from public.orders where funding='deposito' and published_at is not null")
s = q("select * from public.admin_summary()", who=ADM)[0]
paid = one("select coalesce(sum(amount),0) from public.withdrawals where status='pagado'")
eq(ins, s[0] + s[1] + s[2] + s[3] + paid, 'cuadre: lo que entró = custodia + saldos + retiros + ganancia')
print(f'OK: {ok_n} comprobaciones pasaron. Entró {ins}; custodia {s[0]}, saldos {s[1]}, retiros pendientes {s[2]}, pagados {paid}, plataforma {s[3]}')
