"""Prueba de punta a punta en navegador: cliente, agente, agente sin verificar y admin, cada uno en su ventana.
Uso: sh tests/correr_e2e.sh"""
import os, psycopg2
from decimal import Decimal as D
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:8787/app/'
NB = ' '
OUT = '/tmp/e2e'; os.makedirs(OUT, exist_ok=True)
for n, col in [('dni', (230, 230, 210)), ('selfie', (200, 220, 240)), ('voucher', (220, 245, 225))]:
    im = Image.new('RGB', (900, 1200), col); ImageDraw.Draw(im).text((40, 40), n.upper(), fill=(0, 0, 0)); im.save(f'{OUT}/{n}.jpg')

db = psycopg2.connect(host='/tmp/pg', port=5544, user='postgres', dbname=os.environ.get('AMP_DB', 'e2e')); db.autocommit = True
def sqlx(q, a=()):
    c = db.cursor(); c.execute(q, a); return c.fetchall() if c.description else None
def wallet(email): return tuple(sqlx("select wallet, guarantee from public.profiles where email=%s", (email,))[0])

errs = []
def page(ctx, who):
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(f'{who}: {e}'))
    p.on('console', lambda m: errs.append(f'{who} console: {m.text}') if m.type == 'error' and 'fonts' not in m.text and 'ERR_TUNNEL' not in m.text else None)
    p.goto(BASE); return p

def shot(p, name): p.screenshot(path=f'{OUT}/{name}.png', full_page=True)
def click(p, text, nth=0): p.get_by_role('button', name=text, exact=True).nth(nth).click(); p.wait_for_timeout(350)
def tab(p, name): p.locator('.nav button', has_text=name).click(); p.wait_for_timeout(300)
def stab(p, prefix): p.locator('.stabs button', has_text=prefix).first.click(); p.wait_for_timeout(400)
PIN = '482915'
def enter_pin(p, pin=PIN):
    p.wait_for_selector('.pin'); p.keyboard.type(pin); p.wait_for_timeout(900)
def fresh(p): p.reload(); p.wait_for_timeout(800); enter_pin(p)

def register(p, name, dni, phone, dept, email, rol='Cliente', expect_ok=True):
    p.get_by_role('tab', name='Crear cuenta').click(); p.wait_for_timeout(300)
    p.locator('.pick button', has_text=rol).click(); p.wait_for_timeout(200)
    p.fill('#r-name', ''); p.type('#r-name', name); p.fill('#r-dni', dni); p.fill('#r-phone', phone); p.select_option('#r-dept', dept)
    assert p.input_value('#r-name') == name.upper(), 'el nombre se escribe en mayúsculas: ' + p.input_value('#r-name')
    p.fill('#r-email', email); p.fill('#r-pass', 'clave-segura-1'); p.check('#r-tc')
    p.locator('[data-act=eye][data-for=r-pass]').click()
    assert p.get_attribute('#r-pass', 'type') == 'text', 'el ojo debe mostrar la contraseña'
    p.locator('[data-act=register]').click(); p.wait_for_timeout(700)
    if expect_ok:
        expect(p.get_by_text('Crea tu clave de internet')).to_be_visible()
        p.keyboard.type(PIN); p.wait_for_timeout(300)
        expect(p.get_by_text('Repite tu clave')).to_be_visible()
        p.keyboard.type(PIN); p.wait_for_timeout(900)
        expect(p.get_by_text('Tu cuenta aún no está verificada.')).to_be_visible()

def kyc(p):
    click(p, 'Verificar mi identidad')
    p.set_input_files('#k-doc', f'{OUT}/dni.jpg'); p.set_input_files('#k-self', f'{OUT}/selfie.jpg')
    click(p, 'Enviar para verificación'); p.wait_for_timeout(800)

def recargar(p, amount, code):
    tab(p, 'Inicio'); click(p, 'Recargar saldo')
    p.fill('#t-amt', str(amount)); p.fill('#t-code', code); p.set_input_files('#t-file', f'{OUT}/voucher.jpg')
    click(p, 'Ya transferí: validar mi recarga'); p.wait_for_timeout(600)

with sync_playwright() as pw:
    br = pw.chromium.launch()
    phone = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    cli = page(br.new_context(**phone), 'cliente')
    age = page(br.new_context(**phone), 'agente')
    nue = page(br.new_context(**phone), 'agente-sin-fotos')
    adm = page(br.new_context(viewport={'width': 1280, 'height': 900}), 'admin')
    shot(cli, '01-acceso')

    # Registro en mayúsculas, una cuenta por persona, identidad
    cli.get_by_role('tab', name='Crear cuenta').click(); cli.wait_for_timeout(200); shot(cli, '01a-registro'); cli.get_by_role('tab', name='Ingresar').click()
    register(cli, 'luis chávez ramos', '45871203', '987654321', 'Cajamarca', 'luis@prueba.pe'); shot(cli, '01b-registrado'); kyc(cli)
    register(age, 'carmen huamán torres', '41290578', '912345678', 'Arequipa', 'carmen@prueba.pe', 'Agente'); kyc(age)
    register(nue, 'pedro vargas ruiz', '42223333', '955555555', 'Piura', 'pedro@prueba.pe', 'Agente')
    dup = page(br.new_context(**phone), 'duplicado')
    register(dup, 'luis chavez ramos', '45871203', '944000111', 'Lima', 'otro@prueba.pe', expect_ok=False)
    expect(dup.locator('#r-err')).to_contain_text('Ya existe una cuenta con ese DNI'); shot(dup, '01c-duplicado')
    register(adm, 'neisser calla delgado', '11112222', '917486188', 'Lima', 'admin@prueba.pe')
    sqlx("update public.profiles set role='admin', kyc_status='aprobado' where email='admin@prueba.pe'")
    fresh(adm); tab(adm, 'Soporte'); stab(adm, 'Ajustes')
    adm.fill('#cfg-company_account', '193-2458871-0-41'); click(adm, 'Guardar ajustes'); adm.wait_for_timeout(400)
    stab(adm, 'Verificaciones'); shot(adm, '02-soporte-identidad')
    click(adm, 'Confirmar verificación', 0); click(adm, 'Confirmar verificación y activar agente', 0)

    # Cuentas
    for p, accs in [(cli, [('Caja Trujillo', '0071-3302-781')]), (age, [('Caja Trujillo', '0033-1290-417'), ('BCP', '215-4410-9928')])]:
        fresh(p); tab(p, 'Cuenta')
        for e, n in accs:
            p.select_option('#a-ent', e); p.fill('#a-num', n); click(p, 'Agregar cuenta'); p.wait_for_timeout(300)

    # Recargas: cliente y agente; soporte las acredita
    recargar(cli, 3100, '06128833'); shot(cli, '03-recarga')
    recargar(age, 3000, '77001122')
    click(adm, 'Actualizar'); stab(adm, 'Recargas (2)'); shot(adm, '04-soporte-recargas')
    click(adm, f'Llegó: acreditar S/{NB}3,100.00'); click(adm, f'Llegó: acreditar S/{NB}3,000.00')
    assert wallet('luis@prueba.pe') == (D('3100.00'), D('0.00')), wallet('luis@prueba.pe')
    fresh(cli); expect(cli.locator('.big').first).to_contain_text('3,100.00'); shot(cli, '03b-inicio-con-saldo')

    # Cliente publica con su saldo
    click(cli, 'Mover mi dinero')
    cli.fill('#d-amt', '3000'); cli.eval_on_selector('#d-pct', "e=>{e.value='0.5';e.dispatchEvent(new Event('input',{bubbles:true}))}")
    expect(cli.locator('#d-sum')).to_contain_text('3,015.00'); shot(cli, '05-nueva-orden')
    click(cli, 'Publicar mi orden'); cli.wait_for_timeout(500)
    expect(cli.get_by_text('Buscando agente.')).to_be_visible()

    # Agente sin verificar ve la orden pero no puede aceptarla; soporte lo confirma sin fotos
    fresh(nue); tab(nue, 'Órdenes'); shot(nue, '06-sin-verificar-ve-ordenes')
    expect(nue.locator('.oc').first).to_contain_text('3,000.00')
    assert nue.get_by_role('button', name='Aceptar orden').count() == 0
    click(adm, 'Actualizar'); stab(adm, 'Verificaciones (1)')
    adm.locator('input[id^=kn-]').fill('Verificado por videollamada con su DNI'); click(adm, 'Confirmar verificación y activar agente')

    # Agente: sin garantía no puede aceptar; pone garantía y acepta
    fresh(age); tab(age, 'Órdenes')
    expect(age.get_by_role('button', name=f'Tu garantía no alcanza (S/{NB}0.00)').first).to_be_disabled()
    tab(age, 'Billetera'); age.fill('#g-amt', '3000'); click(age, 'Pasar de mi saldo a garantía'); age.wait_for_timeout(400)
    assert wallet('carmen@prueba.pe') == (D('0.00'), D('3000.00')), wallet('carmen@prueba.pe')
    shot(age, '07-garantia')
    tab(age, 'Órdenes'); shot(age, '08-mercado')
    age.locator('.hot').get_by_role('button', name='Aceptar orden').first.click(); age.wait_for_timeout(700)
    age.fill('#v-code', '778812'); age.set_input_files('#v-file', f'{OUT}/voucher.jpg')
    click(age, 'Enviar comprobante'); age.wait_for_timeout(600)

    # Cliente confirma
    fresh(cli); tab(cli, 'Inicio'); cli.locator('.it', has_text='Caja Trujillo').first.click(); cli.wait_for_timeout(800)
    shot(cli, '09-confirmar')
    click(cli, 'Ya llegó a mi cuenta'); cli.wait_for_timeout(600)
    expect(cli.get_by_text('Listo.')).to_be_visible()

    # Retiro: no se descuenta hasta que soporte confirma
    fresh(age); tab(age, 'Billetera')
    expect(age.locator('.big').first).to_contain_text('3,011.25')
    age.fill('#w-amt', '3000'); click(age, 'Solicitar retiro'); age.wait_for_timeout(500)
    assert wallet('carmen@prueba.pe')[0] == D('3011.25'), 'el retiro no se descuenta al pedirlo'
    expect(age.locator('.big').first).to_contain_text('11.25'); shot(age, '10-billetera')
    click(adm, 'Actualizar'); stab(adm, 'Retiros (1)'); shot(adm, '10b-soporte-retiros')
    adm.locator('input[id^=wc-]').fill('0099887766'); click(adm, 'Marcar como pagado'); adm.wait_for_timeout(500)
    assert wallet('carmen@prueba.pe')[0] == D('11.25'), 'al confirmar se descuenta automáticamente'

    # Denuncia de voucher falso -> agente bloqueado; soporte devuelve su saldo y garantía
    fresh(cli); click(cli, 'Mover mi dinero'); cli.fill('#d-amt', '50'); click(cli, 'Publicar mi orden'); cli.wait_for_timeout(500)
    fresh(age); tab(age, 'Órdenes'); age.locator('.hot').get_by_role('button', name='Aceptar orden').first.click(); age.wait_for_timeout(600)
    age.fill('#v-code', '55556666'); age.set_input_files('#v-file', f'{OUT}/voucher.jpg'); click(age, 'Enviar comprobante')
    fresh(cli); cli.locator('.it', has_text=f'S/{NB}50.00').first.click(); cli.wait_for_timeout(600)
    click(cli, 'El voucher es falso'); shot(cli, '11-advertencia')
    click(cli, 'Sí, estoy seguro. Iniciar auditoría'); cli.wait_for_timeout(500)
    click(adm, 'Actualizar'); stab(adm, 'Casos (1)')
    adm.locator('input[id^=cn-]').fill('Caja Trujillo: el código 55556666 no existe')
    click(adm, 'No existe: devolver al cliente y bloquear al agente'); click(adm, 'Confirmar decisión'); adm.wait_for_timeout(500)
    fresh(age); expect(age.get_by_text('Cuenta bloqueada')).to_be_visible()
    click(adm, 'Actualizar'); stab(adm, 'Lista negra'); shot(adm, '12-bloqueados')
    adm.locator('input[id^=bc-]').fill('0011223344'); click(adm, 'Ya le transferí: registrar devolución'); adm.wait_for_timeout(500)
    assert wallet('carmen@prueba.pe') == (D('0.00'), D('0.00')), wallet('carmen@prueba.pe')
    fresh(cli); expect(cli.locator('.big').first).to_contain_text('85.00')

    # La app tiene enlaces a la web y a las páginas legales
    tab(cli, 'Cuenta'); expect(cli.get_by_role('link', name='Libro de reclamaciones')).to_be_visible()

    # Clave incorrecta, bloqueo por 5 minutos sin uso y "Olvidé mi clave"
    cli.reload(); cli.wait_for_timeout(800); cli.keyboard.type('000001'); cli.wait_for_timeout(700)
    expect(cli.get_by_text('Clave incorrecta. Te quedan 4 intentos.')).to_be_visible(); shot(cli, '14-clave-incorrecta')
    cli.keyboard.type(PIN); cli.wait_for_timeout(900); expect(cli.locator('.big').first).to_be_visible()
    ina = br.new_context(**phone).new_page(); ina.on('pageerror', lambda e: errs.append(f'inactividad: {e}'))
    ina.clock.install(); ina.goto(BASE); ina.wait_for_timeout(500)
    ina.fill('#l-email', 'luis@prueba.pe'); ina.fill('#l-pass', 'clave-segura-1'); click(ina, 'Ingresar'); ina.wait_for_timeout(600)
    enter_pin(ina); expect(ina.get_by_text('Hola, LUIS')).to_be_visible()
    ina.clock.fast_forward('05:20'); ina.wait_for_timeout(600)
    expect(ina.get_by_text('Por seguridad bloqueamos la app después de 5 minutos sin uso.')).to_be_visible(); shot(ina, '15-bloqueo-inactividad')
    click(ina, 'Olvidé mi clave'); ina.wait_for_timeout(500)
    ina.fill('#l-email', 'luis@prueba.pe'); ina.fill('#l-pass', 'clave-segura-1'); click(ina, 'Ingresar'); ina.wait_for_timeout(600)
    expect(ina.get_by_text('Crea tu nueva clave de internet')).to_be_visible()
    ina.keyboard.type('739104'); ina.wait_for_timeout(300); ina.keyboard.type('739104'); ina.wait_for_timeout(900)
    expect(ina.get_by_text('Hola, LUIS')).to_be_visible()
    cli.reload(); cli.wait_for_timeout(800); enter_pin(cli, '739104'); expect(cli.locator('.big').first).to_be_visible()

    # Actualización obligatoria del APK
    old = br.new_context(**phone, user_agent='Mozilla/5.0 (Linux; Android 13) AgenteMovilP2P/3').new_page()
    old.route('**/version.json*', lambda r: r.fulfill(status=200, content_type='application/json', body='{"apk": 7, "url": "https://example.com/agente-movil-p2p.apk"}'))
    old.goto(BASE); old.wait_for_timeout(600)
    expect(old.get_by_text('Hay una nueva versión')).to_be_visible()
    expect(old.get_by_role('link', name='Descargar actualización')).to_have_attribute('href', 'https://example.com/agente-movil-p2p.apk'); shot(old, '16-actualizar-apk')
    new = br.new_context(**phone, user_agent='Mozilla/5.0 (Linux; Android 13) AgenteMovilP2P/7').new_page()
    new.route('**/version.json*', lambda r: r.fulfill(status=200, content_type='application/json', body='{"apk": 7, "url": "x"}'))
    new.goto(BASE); new.wait_for_timeout(600); expect(new.get_by_role('tab', name='Ingresar')).to_be_visible()

    # Reclamos y web
    sqlx("set role anon; select public.submit_complaint('reclamo','Rosa Quispe Mamani','45556677','Av. Lima 123','987654321','rosa@x.pe',100,'Transferencia OP-00001','El dinero no llegó a tiempo','Devolución'); reset role;")
    click(adm, 'Actualizar'); stab(adm, 'Reclamos (1)')
    adm.locator('textarea[id^=ra-]').fill('Le escribimos por correo: la operación se completó el mismo día.'); click(adm, 'Registrar respuesta'); adm.wait_for_timeout(400)
    click(adm, 'Actualizar'); shot(adm, '13-soporte-final')
    for w, n in [(1280, 'web-escritorio'), (390, 'web-celular')]:
        wp = br.new_page(viewport={'width': w, 'height': 900}); wp.on('pageerror', lambda e: errs.append(f'web: {e}'))
        for pg_ in ['index.html', 'terminos.html', 'libro-reclamaciones.html']:
            wp.goto('http://127.0.0.1:8787/' + pg_); wp.wait_for_timeout(300)
            sw = wp.evaluate('document.documentElement.scrollWidth')
            if sw > w: errs.append(f'{pg_} se desborda a {w}px: {sw}')
        wp.goto('http://127.0.0.1:8787/index.html'); wp.wait_for_timeout(300)
        assert wp.locator('.topbar a', has_text='Descargar APK').is_visible(), 'botón de descarga visible arriba'
        assert wp.locator('header a', has_text='Iniciar sesión').is_visible(), 'botón Iniciar sesión visible en la web'
        wp.screenshot(path=f'{OUT}/{n}.png')
    print('Saldos:', sqlx("select full_name, wallet, guarantee, banned from public.profiles order by full_name"))
    br.close()
print('ERRORES:', errs or 'ninguno')
