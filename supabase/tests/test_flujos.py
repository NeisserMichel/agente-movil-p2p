"""Pruebas de los flujos de dinero de schema.sql contra un Postgres local.
Uso: sh supabase/tests/correr.sh"""
import psycopg2, psycopg2.extras, uuid
from decimal import Decimal as D
psycopg2.extras.register_uuid()

cx = psycopg2.connect(host='/tmp/pg', port=5544, user='postgres', dbname='t')
cx.autocommit = True
ok_n = 0

def q(sql, args=(), who=None, role='authenticated'):
    cur = cx.cursor()
    if who or role == 'anon':
        cur.execute(f"set role {role}; select set_config('request.jwt.claim.sub', %s, false)", (str(who or ''),))
    else:
        cur.execute("reset role; select set_config('request.jwt.claim.sub', '', false)")
    try:
        cur.execute(sql, args)
        return cur.fetchall() if cur.description else None
    finally:
        cur.execute("reset role")

def one(sql, args=(), who=None):
    r = q(sql, args, who); return r[0][0] if r else None

def fails(sql, args=(), who=None, contains='', role='authenticated'):
    global ok_n
    try:
        q(sql, args, who, role)
    except Exception as e:
        msg = str(e).split('\n')[0]
        assert contains in msg, f'esperaba "{contains}" y vino: {msg}'
        ok_n += 1; return msg
    raise AssertionError('debía fallar: ' + sql)

def eq(a, b, what):
    global ok_n
    assert a == b, f'{what}: {a!r} != {b!r}'; ok_n += 1

def user(email, name, dni, phone=None, rol='cliente', dept='Lima'):
    uid = uuid.uuid4()
    q("insert into auth.users (id,email,raw_user_meta_data) values (%s,%s,json_build_object('full_name',%s::text,'dni',%s::text,'dept',%s::text,'phone',%s::text,'rol',%s::text))",
      (uid, email, name, dni, dept, phone or ('9' + dni), rol))
    return uid

def kyc(uid, name, dni):
    one("select public.submit_kyc(%s,%s,%s,%s)", (name, dni, f'{uid}/dni.jpg', f'{uid}/selfie.jpg'), uid)

code_n = [100000]
def topup(uid, amount):
    """El usuario reporta una recarga y soporte la valida."""
    code_n[0] += 1
    t = one("select public.request_topup(%s,%s,%s)", (amount, str(code_n[0]), f'{uid}/r{code_n[0]}.jpg'), uid)
    one("select public.review_topup(%s,true,null)", (t,), ADM)
    return t

def upload(uid, order):
    name = f'{order}/{uid}-1.jpg'
    q("insert into storage.objects (bucket_id,name) values ('comprobantes',%s)", (name,), uid)
    return name

def st(o): return one("select status from public.orders where id=%s", (o,))
def wal(u): return one("select wallet from public.profiles where id=%s", (u,))
def gar(u): return one("select guarantee from public.profiles where id=%s", (u,))
def newuser_sql(email, dni, phone): return ("insert into auth.users (email, raw_user_meta_data) values (%s, json_build_object('full_name','OTRO','dni',%s::text,'phone',%s::text))", (email, dni, phone))

# ---------- registro: lista negra, mayúsculas y datos únicos ----------
q("insert into public.blacklist (dni, full_name, reason) values ('40112233','MARCO RIVAS','Voucher adulterado')")
ADM = user('admin@x.pe', 'Neisser Calla Delgado', '11111111')
q("update public.profiles set role='admin', kyc_status='aprobado' where id=%s", (ADM,))
C = user('luis@x.pe', 'luis  chávez ramos', '45871203', '987654321', dept='Cajamarca')
G = user('carmen@x.pe', 'Carmen Huamán Torres', '41290578', '912345678', rol='agente', dept='Arequipa')
H = user('pedro@x.pe', 'Pedro Vargas Ruiz', '42223333', '955555555', rol='agente', dept='Piura')
X = user('malo@x.pe', 'Marco Rivas', '40112233')
eq(one("select full_name from public.profiles where id=%s", (C,)), 'LUIS CHÁVEZ RAMOS', 'el nombre se guarda en mayúsculas')
eq(one("select banned from public.profiles where id=%s", (X,)), True, 'DNI en lista negra queda bloqueado al registrarse')
fails(*newuser_sql('otro@x.pe', '45871203', '911111111'), contains='profiles_dni_unique')
fails(*newuser_sql('otro2@x.pe', '49999999', '987654321'), contains='profiles_phone_unique')
eq(one("select agent_status from public.profiles where id=%s", (G,)), 'solicitado', 'registro como agente queda solicitado')

# ---------- verificación ----------
fails("select public.request_topup(100,'123456',%s)", (f'{C}/a.jpg',), C, 'verificamos tu identidad')
eq(len(q("select * from public.list_market()", who=G)), 0, 'usuario sin verificar puede ver el mercado')
for u, n, d in [(C,'LUIS CHÁVEZ RAMOS','45871203'), (G,'CARMEN HUAMÁN TORRES','41290578'), (H,'PEDRO VARGAS RUIZ','42223333')]:
    kyc(u, n, d)
fails("select public.review_kyc(%s,true,null)", (C,), G, 'Solo soporte')
for u in (C, G, H): one("select public.review_kyc(%s,true,null)", (u,), ADM)
eq(one("select agent_status||'/'||kyc_status from public.profiles where id=%s", (G,)), 'activo/aprobado', 'confirmar verificación activa al agente')

# ---------- impostor con DNI ajeno: soporte lo rechaza y libera el DNI ----------
SQ = user('impostor@x.pe', 'Impostor Uno', '48889999', '944444444')
fails(*newuser_sql('real@x.pe', '48889999', '933333333'), contains='profiles_dni_unique')
one("select public.review_kyc(%s,false,'La selfie no coincide con el DNI')", (SQ,), ADM)
REAL = user('real@x.pe', 'Persona Real Dos', '48889999', '933333333')
eq(one("select count(*) from public.profiles where dni='48889999'"), 2, 'tras rechazar al impostor, el verdadero dueño puede registrarse')

# ---------- cuentas ----------
c_bcp = one("select public.add_account('BCP','245-1877-4410')", who=C)
c_ct  = one("select public.add_account('Caja Trujillo','0071-3302-781')", who=C)
g_ct  = one("select public.add_account('Caja Trujillo','0033-1290-417')", who=G)
g_bcp = one("select public.add_account('BCP','215-4410-9928')", who=G)
h_ct  = one("select public.add_account('Caja Trujillo','0099-1111-222')", who=H)
eq(one("select holder from public.bank_accounts where id=%s", (c_ct,)), 'LUIS CHÁVEZ RAMOS', 'titular sale del perfil')

# ---------- recargas ----------
fails("select public.request_topup(100,'123456',%s)", (f'{C}/a.jpg',), C, 'cuenta para recargas')
q("update public.settings set company_account='193-2458871-0-41'")
fails("select public.request_topup(5,'123456',%s)", (f'{C}/a.jpg',), C, 'mínima')
fails("select public.request_topup(100,'12',%s)", (f'{C}/a.jpg',), C, 'código')
fails("select public.request_topup(100,'123456',%s)", (f'{G}/a.jpg',), C, 'captura')
t1 = one("select public.request_topup(5000,'06128833',%s)", (f'{C}/r1.jpg',), C)
eq(wal(C), D('0.00'), 'la recarga no suma hasta que soporte la valida')
fails("select public.request_topup(5000,'06128833',%s)", (f'{C}/r2.jpg',), C, 'ya fue reportado')
fails("select public.review_topup(%s,true,null)", (t1,), C, 'Solo soporte')
one("select public.review_topup(%s,true,null)", (t1,), ADM)
eq(wal(C), D('5000.00'), 'recarga validada aparece en el saldo virtual')
fails("select public.review_topup(%s,true,null)", (t1,), ADM, 'ya fue revisada')
t2 = one("select public.request_topup(300,'55550000',%s)", (f'{C}/r3.jpg',), C)
one("select public.review_topup(%s,false,'No encontramos el depósito')", (t2,), ADM)
eq(wal(C), D('5000.00'), 'recarga rechazada no suma')
eq(len(q("select * from public.topups", who=G)), 0, 'nadie ve las recargas de otro')
fails("insert into storage.objects (bucket_id,name) values ('recargas', %s)", (f'{C}/x.jpg',), G, 'row-level security')

# ---------- órdenes solo con saldo ----------
fails("select public.create_order(%s, 1000, 0.2, 'deposito')", (c_ct,), C, 'saldo virtual')
fails("select public.create_order(%s, 6000, 0.2, 'saldo')", (c_ct,), C, 'límite')
fails("select public.create_order(%s, 1000, 0.1, 'saldo')", (c_ct,), C, 'comisión')
fails("select public.create_order(%s, 1000, 0.2, 'saldo')", (g_ct,), C, 'tus cuentas')

# ---------- 1. flujo feliz con garantía ----------
o1 = one("select public.create_order(%s, 3000, 0.5, 'saldo')", (c_ct,), C)
eq((st(o1), wal(C)), ('publicada', D('1985.00')), 'publicada al instante y saldo descontado (3000 + 15)')
eq(q("select is_mine from public.list_market() where id=%s", (o1,), C)[0][0], True, 'el cliente ve su propia orden')
eq(len(q("select * from public.list_market()", who=H)), 1, 'otro usuario ve la orden publicada')
eq(len(q("select dest_number from public.orders where id=%s", (o1,), G)), 0, 'agente no ve la cuenta antes de aceptar')
fails("select public.accept_order(%s)", (o1,), C, 'agentes verificados')
fails("select public.accept_order(%s)", (o1,), G, 'garantía')
fails("select public.add_guarantee(100)", who=G, contains='saldo disponible')
topup(G, 2000)
fails("select public.add_guarantee(100)", who=C, contains='agentes')
one("select public.add_guarantee(2000)", who=G)
eq((wal(G), gar(G)), (D('0.00'), D('2000.00')), 'saldo pasa a garantía')
fails("select public.accept_order(%s)", (o1,), G, 'hasta ese monto')
topup(G, 1000); one("select public.add_guarantee(1000)", who=G)
one("select public.accept_order(%s)", (o1,), G)
fails("select public.accept_order(%s)", (o1,), H, 'Otro agente')
fails("select public.release_guarantee(100)", who=G, contains='orden en curso')
eq(q("select dest_number, dest_holder from public.orders where id=%s", (o1,), G)[0], ('0071-3302-781', 'LUIS CHÁVEZ RAMOS'), 'agente ve la cuenta y el titular')
v1 = upload(G, o1)
one("select public.submit_voucher(%s,'778812',%s)", (o1, v1), G)
eq(one("select public.can_read_proof(%s)", (v1,), C), True, 'cliente puede ver el voucher')
eq(one("select public.can_read_proof(%s)", (v1,), H), False, 'otro agente no ve el voucher')
one("select public.client_not_yet(%s)", (o1,), C)
one("select public.client_confirm(%s)", (o1,), C)
eq(st(o1), 'completada', 'orden completada')
eq((wal(G), gar(G)), (D('3011.25'), D('3000.00')), 'agente recibe monto + 75% de comisión; su garantía queda intacta')
eq(one("select platform_earned from public.admin_summary()", who=ADM), D('3.75'), 'plataforma gana 25%')
one("select public.release_guarantee(500)", who=G)
eq((wal(G), gar(G)), (D('3511.25'), D('2500.00')), 'libera garantía a su saldo')

# ---------- seguridad directa ----------
fails("update public.profiles set wallet = 99999 where id=%s", (G,), G, 'permission denied')
fails("update public.profiles set guarantee = 99999 where id=%s", (G,), G, 'permission denied')
fails("select app_private.wallet_move(%s, 100, 'x', null, 'x')", (G,), G, 'permission denied')
fails("insert into public.topups (user_id, amount, op_code, proof_path) values (%s, 100, '1', 'x')", (G,), G, 'permission denied')
eq(len(q("select * from public.profiles", who=C)), 1, 'cliente solo ve su perfil')

# ---------- 2. agente no transfiere: strike y devolución ----------
o2 = one("select public.create_order(%s, 1000, 0.2, 'saldo')", (c_ct,), C)
one("select public.accept_order(%s)", (o2,), G)
q("update public.orders set agent_deadline = now() - interval '1 min' where id=%s", (o2,))
eq(one("select public.tick()", who=C), 1, 'reloj procesa 1 orden')
eq((st(o2), wal(C)), ('reembolsada', D('1985.00')), 'dinero devuelto al saldo del cliente')
eq(one("select strikes from public.profiles where id=%s", (G,)), 1, 'strike 1')
fails("select public.accept_order(1)", who=G, contains='suspendido')

# ---------- 3. voucher falso: soporte bloquea al agente; su garantía queda para soporte ----------
topup(H, 1500); one("select public.add_guarantee(1500)", who=H)
o3 = one("select public.create_order(%s, 1000, 0.2, 'saldo')", (c_ct,), C)
one("select public.accept_order(%s)", (o3,), H)
one("select public.submit_voucher(%s,'111222',%s)", (o3, upload(H, o3)), H)
one("select public.client_report_fake(%s)", (o3,), C)
k3 = one("select id from public.cases where order_id=%s", (o3,), ADM)
one("select public.resolve_case(%s,false,'Caja: el código no existe')", (k3,), ADM)
eq((st(o3), wal(C)), ('reembolsada', D('1985.00')), 'cliente recupera su dinero')
eq((one("select banned from public.profiles where id=%s", (H,)), gar(H)), (True, D('1500.00')), 'agente bloqueado; garantía retenida')
fails("select public.release_guarantee(100)", who=H, contains='bloqueada')
eq(one("select public.staff_settle_banned(%s,'0099001122')", (H,), ADM), D('1500.00'), 'soporte devuelve saldo y garantía a la persona bloqueada')
eq((wal(H), gar(H)), (D('0.00'), D('0.00')), 'cuenta bloqueada queda en cero')

# ---------- 4. cliente no responde: soporte verifica y libera ----------
one("select public.staff_lift_suspension(%s)", (G,), ADM)
o4 = one("select public.create_order(%s, 1000, 0.2, 'saldo')", (c_ct,), C)
one("select public.accept_order(%s)", (o4,), G)
one("select public.submit_voucher(%s,'555666',%s)", (o4, upload(G, o4)), G)
q("update public.orders set client_deadline = now() - interval '1 min' where id=%s", (o4,))
one("select public.tick()", who=G)
one("select public.resolve_case((select id from public.cases where order_id=%s),true,'Caja Trujillo confirma')", (o4,), ADM)
eq((st(o4), wal(G)), ('completada', D('4512.75')), 'agente cobra tras verificación')

# ---------- 5. caída de entidad pausa los relojes ----------
o5 = one("select public.create_order(%s, 500, 0.2, 'saldo')", (c_ct,), C)
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
eq(st(o5), 'reembolsada', 'devuelto sin strike')
eq(one("select strikes from public.profiles where id=%s", (G,)), 1, 'sin strike por reportar titular')
fails("select public.create_order(%s, 500, 0.2, 'saldo')", (c_ct,), C, 'observada')

# ---------- 7. retiros: se descuentan cuando soporte confirma ----------
fails("select public.request_withdrawal(%s, 99999)", (g_bcp,), G, 'saldo disponible')
w = one("select public.request_withdrawal(%s, 4000)", (g_bcp,), G)
eq(wal(G), D('4512.75'), 'pedir un retiro NO descuenta todavía')
fails("select public.add_guarantee(1000)", who=G, contains='saldo disponible')
fails("select public.request_withdrawal(%s, 1000)", (g_bcp,), G, 'saldo disponible')
one("select public.resolve_withdrawal(%s,true,'0099887766')", (w,), ADM)
eq(wal(G), D('512.75'), 'al confirmar el pago se descuenta automáticamente')
w2 = one("select public.request_withdrawal(%s, 500)", (g_bcp,), G)
one("select public.resolve_withdrawal(%s,false,'cuenta cerrada')", (w2,), ADM)
eq(wal(G), D('512.75'), 'retiro rechazado no toca el saldo')
fails("select public.resolve_withdrawal(%s,true,'1')", (w2,), ADM, 'ya fue procesado')
# retiro antiguo (versión anterior: se descontaba al pedirlo). Si se rechaza, se devuelve.
q("update public.profiles set wallet = wallet - 12.75 where id=%s", (G,))
w3 = one("insert into public.withdrawals (user_id, account_id, entity, number, amount, debited) values (%s,%s,'BCP','215',12.75,true) returning id", (G, g_bcp))
one("select public.resolve_withdrawal(%s,false,'prueba')", (w3,), ADM)
eq(wal(G), D('512.75'), 'retiro antiguo rechazado devuelve el saldo')

# ---------- 8. denuncia falsa: el cliente es bloqueado y sus órdenes publicadas se cancelan ----------
c2_ct = one("select public.add_account('Caja Trujillo','0071-3302-999')", who=C)
o8 = one("select public.create_order(%s, 400, 0.2, 'saldo')", (c2_ct,), C)
o8b = one("select public.create_order(%s, 300, 0.2, 'saldo')", (c2_ct,), C)
wc = one("select public.request_withdrawal(%s, 100)", (c_bcp,), C)
one("select public.accept_order(%s)", (o8,), G)
one("select public.submit_voucher(%s,'444555',%s)", (o8, upload(G, o8)), G)
before = wal(C)
one("select public.client_report_fake(%s)", (o8,), C)
one("select public.resolve_case((select id from public.cases where order_id=%s),true,'El dinero sí llegó')", (o8,), ADM)
eq(one("select banned from public.profiles where id=%s", (C,)), True, 'cliente que mintió bloqueado')
eq(st(o8b), 'cancelada', 'su otra orden publicada se cancela')
eq(wal(C), before + D('300.60'), 'y el dinero de esa orden vuelve a su saldo')
eq(one("select status from public.withdrawals where id=%s", (wc,)), 'rechazado', 'su retiro pendiente se anula')
fails("select public.create_order(%s, 100, 0.2, 'saldo')", (c_ct,), C, 'bloqueada')
one("select public.staff_settle_banned(%s,'0011223344')", (C,), ADM)
eq(wal(C), D('0.00'), 'soporte devuelve todo el saldo del cliente bloqueado')

# ---------- visitante sin cuenta (anon) ----------
code = q("select public.submit_complaint('reclamo','Rosa Quispe Mamani','45556677','Av. Lima 123','987654321','rosa@x.pe',100,'Transferencia OP-00001','El dinero no llegó a tiempo','Devolución')", role='anon')[0][0]
eq(code.startswith('R-'), True, 'visitante puede dejar un reclamo')
for bad in ["select public.tick()", "select * from public.complaints", "select * from public.orders", "select * from public.topups", "select public.create_order(1,100,0.2,'saldo')"]:
    fails(bad, role='anon', contains='permission denied')
eq(len(q("select * from public.complaints", who=ADM)), 1, 'soporte ve los reclamos')

# ---------- cuadre total del dinero ----------
ins = one("select coalesce(sum(amount),0) from public.topups where status='aprobada'")
s = q("select custody, wallets, guarantees, withdrawals_held, platform_earned from public.admin_summary()", who=ADM)[0]
out = one("select coalesce(sum(amount),0) from public.withdrawals where status='pagado'")
settled = one("select coalesce(-sum(amount),0) from public.wallet_ledger where kind='devolucion_bloqueo'")
eq(ins, sum(s) + out + settled, 'cuadre: recargas = custodia + saldos + garantías + retenidos + ganancia + pagos')
print(f'OK: {ok_n} comprobaciones pasaron. Recargas {ins}; custodia {s[0]}, saldos {s[1]}, garantías {s[2]}, plataforma {s[4]}, retiros pagados {out}, devuelto a bloqueados {settled}')
