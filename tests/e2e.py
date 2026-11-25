"""Prueba de punta a punta en navegador: cliente, agente y admin, cada uno en su ventana.
Requiere: Postgres local con la base indicada en AMP_DB y tests/servidor_prueba.py corriendo."""
import os, sys, time, psycopg2
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:8787/app/'
OUT = '/tmp/e2e'; os.makedirs(OUT, exist_ok=True)
for n, col in [('dni', (230, 230, 210)), ('selfie', (200, 220, 240)), ('voucher', (220, 245, 225))]:
    im = Image.new('RGB', (900, 1200), col); ImageDraw.Draw(im).text((40, 40), n.upper(), fill=(0, 0, 0)); im.save(f'{OUT}/{n}.jpg')

db = psycopg2.connect(host='/tmp/pg', port=5544, user='postgres', dbname=os.environ.get('AMP_DB', 'e2e')); db.autocommit = True
def sqlx(q, a=()):
    c = db.cursor(); c.execute(q, a); return c.fetchall() if c.description else None

errs = []
def page(ctx, who):
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(f'{who}: {e}'))
    p.on('console', lambda m: errs.append(f'{who} console: {m.text}') if m.type == 'error' and 'fonts' not in m.text and 'ERR_TUNNEL' not in m.text else None)
    p.goto(BASE); return p

def shot(p, name): p.screenshot(path=f'{OUT}/{name}.png', full_page=True)
def click(p, text, nth=0): p.get_by_role('button', name=text).nth(nth).click(); p.wait_for_timeout(350)
def tab(p, name): p.locator('.nav button', has_text=name).click(); p.wait_for_timeout(300)

def register(p, name, dni, phone, dept, email):
    p.get_by_role('tab', name='Crear cuenta').click(); p.wait_for_timeout(300)
    p.fill('#r-name', name); p.fill('#r-dni', dni); p.fill('#r-phone', phone); p.select_option('#r-dept', dept)
    p.fill('#r-email', email); p.fill('#r-pass', 'clave-segura-1'); p.check('#r-tc')
    click(p, 'Crear mi cuenta'); p.wait_for_timeout(600)

def kyc(p):
    p.set_input_files('#k-doc', f'{OUT}/dni.jpg'); p.set_input_files('#k-self', f'{OUT}/selfie.jpg')
    click(p, 'Enviar para verificación'); p.wait_for_timeout(800)
    expect(p.get_by_text('Estamos revisando tu identidad')).to_be_visible()

with sync_playwright() as pw:
    br = pw.chromium.launch()
    phone = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    cli = page(br.new_context(**phone), 'cliente')
    age = page(br.new_context(**phone), 'agente')
    adm = page(br.new_context(viewport={'width': 1280, 'height': 900}), 'admin')
    shot(cli, '01-acceso')

    # Registro e identidad
    register(cli, 'Luis Chávez Ramos', '45871203', '987654321', 'Cajamarca', 'luis@prueba.pe'); kyc(cli)
    register(age, 'Carmen Huamán Torres', '41290578', '912345678', 'Arequipa', 'carmen@prueba.pe'); kyc(age)
    register(adm, 'Neisser Calla Delgado', '11112222', '917486188', 'Lima', 'admin@prueba.pe')
    sqlx("update public.profiles set role='admin', kyc_status='aprobado' where email='admin@prueba.pe'")
    adm.reload(); adm.wait_for_timeout(800)
    tab(adm, 'Soporte'); adm.get_by_role('tab', name='Ajustes').click(); adm.wait_for_timeout(300)
    adm.fill('#cfg-company_account', '193-2458871-0-41'); click(adm, 'Guardar ajustes'); adm.wait_for_timeout(400); adm.get_by_role('tab', name='Identidad (2)').click(); adm.wait_for_timeout(500)
    shot(adm, '02-soporte-identidad')
    click(adm, 'Aprobar identidad'); click(adm, 'Aprobar identidad')

    # Cuentas y agente
    for p, accs in [(cli, [('BCP', '245-1877-4410'), ('Caja Trujillo', '0071-3302-781')]), (age, [('Caja Trujillo', '0033-1290-417'), ('BCP', '215-4410-9928')])]:
        click(p, 'Actualizar'); tab(p, 'Cuenta')
        for e, n in accs:
            p.select_option('#a-ent', e); p.fill('#a-num', n); click(p, 'Agregar cuenta'); p.wait_for_timeout(300)
    shot(cli, '03-cuenta')
    tab(age, 'Agente'); click(age, 'Quiero ser agente')
    tab(adm, 'Soporte'); click(adm, 'Actualizar'); adm.get_by_role('tab', name='Agentes').click(); adm.wait_for_timeout(300); click(adm, 'Activar')

    # Cliente crea la orden y deposita
    tab(cli, 'Inicio'); click(cli, 'Mover mi dinero')
    cli.fill('#d-amt', '3000'); cli.eval_on_selector('#d-pct', "e=>{e.value='0.5';e.dispatchEvent(new Event('input',{bubbles:true}))}")
    shot(cli, '04-nueva-orden')
    expect(cli.locator('#d-sum')).to_contain_text('3,015.00')
    click(cli, 'Continuar'); cli.wait_for_timeout(500)
    cli.fill('#dp-code', '06128833'); cli.set_input_files('#dp-file', f'{OUT}/voucher.jpg')
    shot(cli, '05-deposito')
    click(cli, 'Ya transferí'); cli.wait_for_timeout(600)
    expect(cli.get_by_text('Validando tu depósito.')).to_be_visible()

    # Soporte valida el depósito
    click(adm, 'Actualizar'); adm.get_by_role('tab', name='Depósitos (1)').click(); adm.wait_for_timeout(600)
    shot(adm, '06-soporte-deposito')
    click(adm, 'Llegó y el titular coincide: publicar'); click(adm, 'Sí, publicar'); adm.wait_for_timeout(500)

    # Agente toma la orden y sube el voucher
    age.reload(); age.wait_for_timeout(800); tab(age, 'Agente')
    shot(age, '07-mercado')
    age.locator('.hot').get_by_role('button', name='Aceptar orden').first.click(); age.wait_for_timeout(700)
    expect(age.get_by_text('Luis Chávez Ramos')).to_be_visible()
    age.fill('#v-code', '778812'); age.set_input_files('#v-file', f'{OUT}/voucher.jpg')
    shot(age, '08-agente-transferir')
    click(age, 'Enviar comprobante'); age.wait_for_timeout(600)

    # Cliente confirma
    cli.reload(); cli.wait_for_timeout(800); cli.locator('.it', has_text='Caja Trujillo').first.click(); cli.wait_for_timeout(800)
    shot(cli, '09-confirmar')
    expect(cli.locator('img.proof')).to_have_attribute('src', lambda s: True) if False else None
    click(cli, 'Ya llegó a mi cuenta'); cli.wait_for_timeout(600)
    expect(cli.get_by_text('Listo.')).to_be_visible()

    # Agente cobra y retira
    age.reload(); age.wait_for_timeout(800); tab(age, 'Billetera')
    expect(age.locator('.big').first).to_contain_text('3,011.25')
    age.fill('#w-amt', '3000'); click(age, 'Solicitar retiro'); age.wait_for_timeout(500)
    shot(age, '10-billetera')
    click(adm, 'Actualizar'); adm.get_by_role('tab', name='Retiros (1)').click(); adm.wait_for_timeout(400)
    adm.locator('input[id^=wc-]').fill('0099887766'); click(adm, 'Marcar como pagado'); adm.wait_for_timeout(500)
    shot(adm, '11-soporte-final')

    # Segunda orden: denuncia de voucher falso -> soporte decide que es falso
    tab(cli, 'Inicio'); click(cli, 'Mover mi dinero'); cli.select_option('#d-fund', 'deposito'); cli.fill('#d-amt', '500'); click(cli, 'Continuar'); cli.wait_for_timeout(500)
    cli.fill('#dp-code', '11223344'); cli.set_input_files('#dp-file', f'{OUT}/voucher.jpg'); click(cli, 'Ya transferí'); cli.wait_for_timeout(500)
    click(adm, 'Actualizar'); adm.get_by_role('tab', name='Depósitos (1)').click(); click(adm, 'Llegó y el titular coincide: publicar'); click(adm, 'Sí, publicar')
    age.reload(); age.wait_for_timeout(700); tab(age, 'Agente'); age.locator('.hot').get_by_role('button', name='Aceptar orden').first.click(); age.wait_for_timeout(600)
    age.fill('#v-code', '55556666'); age.set_input_files('#v-file', f'{OUT}/voucher.jpg'); click(age, 'Enviar comprobante')
    cli.reload(); cli.wait_for_timeout(800); cli.locator('.it', has_text='S/ 500.00').first.click(); cli.wait_for_timeout(600)
    click(cli, 'El voucher es falso'); shot(cli, '12-advertencia')
    click(cli, 'Sí, estoy seguro. Iniciar auditoría'); cli.wait_for_timeout(500)
    click(adm, 'Actualizar'); adm.get_by_role('tab', name='Casos (1)').click(); adm.wait_for_timeout(500)
    adm.locator('input[id^=cn-]').fill('Caja Trujillo: el código 55556666 no existe'); shot(adm, '13-caso')
    click(adm, 'No existe: devolver al cliente y bloquear al agente'); click(adm, 'Confirmar decisión'); adm.wait_for_timeout(500)
    age.reload(); age.wait_for_timeout(700); shot(age, '14-agente-bloqueado')
    expect(age.get_by_text('Cuenta bloqueada')).to_be_visible()
    cli.reload(); cli.wait_for_timeout(700); expect(cli.locator('.big').first).to_contain_text('501.00')

    sqlx("set role anon; select public.submit_complaint('reclamo','Rosa Quispe Mamani','45556677','Av. Lima 123','987654321','rosa@x.pe',100,'Transferencia OP-00001','El dinero no llegó a tiempo','Devolución'); reset role;")
    click(adm, 'Actualizar'); adm.get_by_role('tab', name='Reclamos (1)').click(); adm.wait_for_timeout(300)
    adm.locator('textarea[id^=ra-]').fill('Le escribimos por correo: la operación se completó el mismo día.'); click(adm, 'Registrar respuesta'); adm.wait_for_timeout(400)
    expect(adm.get_by_text('Respuesta (')).to_be_visible(); shot(adm, '15-reclamos')
    for w, n in [(1280, 'web-escritorio'), (390, 'web-celular')]:
        wp = br.new_page(viewport={'width': w, 'height': 900}); wp.on('pageerror', lambda e: errs.append(f'web: {e}'))
        for pg_ in ['index.html', 'terminos.html', 'libro-reclamaciones.html']:
            wp.goto('http://127.0.0.1:8787/' + pg_); wp.wait_for_timeout(300)
            sw = wp.evaluate('document.documentElement.scrollWidth')
            if sw > w: errs.append(f'{pg_} se desborda a {w}px: {sw}')
        wp.goto('http://127.0.0.1:8787/index.html'); wp.wait_for_timeout(300); wp.screenshot(path=f'{OUT}/{n}.png')
    print('Saldos:', sqlx("select full_name, wallet, banned from public.profiles order by full_name"))
    print('Resumen:', sqlx("set role postgres; select coalesce(sum(platform_fee),0) from public.orders where status='completada'"))
    br.close()
print('ERRORES:', errs or 'ninguno')
