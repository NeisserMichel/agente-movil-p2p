/* Agente Móvil P2P · app para clientes, agentes y soporte.
   Toda regla de dinero vive en Supabase (supabase/schema.sql); aquí solo se muestra y se llama a esas funciones. */
{
const C = window.AMP_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const pctS = p => (+p).toFixed(2).replace(/0$/, '') + '%';
const tail = n => '••' + String(n || '').replace(/\D/g, '').slice(-3);
const mask = d => d ? d.slice(0, 1) + '•••••' + d.slice(-2) : '—';
const hm = t => t ? new Date(t).toLocaleTimeString('es-PE', {hour: '2-digit', minute: '2-digit'}) : '';
const when = t => t ? new Date(t).toLocaleString('es-PE', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : '';
const DEPTS = ['Amazonas','Áncash','Apurímac','Arequipa','Ayacucho','Cajamarca','Callao','Cusco','Huancavelica','Huánuco','Ica','Junín','La Libertad','Lambayeque','Lima','Loreto','Madre de Dios','Moquegua','Pasco','Piura','Puno','San Martín','Tacna','Tumbes','Ucayali'];
const LIVE = ['deposito_pendiente','deposito_revision','publicada','aceptada','confirmacion','revision'];
const ST = {
  deposito_pendiente: ['Falta tu depósito','t-warn'], deposito_revision: ['Validando depósito','t-warn'],
  publicada: ['Buscando agente','t-info'], aceptada: ['Agente transfiriendo','t-info'],
  confirmacion: ['Confirma la llegada','t-warn'], revision: ['En revisión','t-warn'],
  completada: ['Completada','t-ok'], reembolsada: ['Devuelto al saldo','t-mute'],
  cancelada: ['Cancelada','t-mute'], rechazada: ['Depósito rechazado','t-bad']
};
const IC = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  agent: '<path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2M4 12h16"/>',
  wal: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  send: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;

/* ======================= CONEXIÓN A SUPABASE ======================= */
let sb = null;
const api = window.AMP_TEST_API || {
  async init() {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';
      s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar Supabase. Revisa tu conexión.'));
      document.head.appendChild(s);
    });
    sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  },
  async session() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },
  async signUp(v) {
    const { data, error } = await sb.auth.signUp({ email: v.email, password: v.password,
      options: { data: { full_name: v.full_name, dni: v.dni, phone: v.phone, dept: v.dept, rol: v.rol }, emailRedirectTo: location.href.split('#')[0] } });
    if (error) throw error; return !!data.session;
  },
  async signIn(e, p) { const { error } = await sb.auth.signInWithPassword({ email: e, password: p }); if (error) throw error; },
  async signOut() { await sb.auth.signOut(); },
  async reset(e) { const { error } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.href.split('#')[0] }); if (error) throw error; },
  async newPassword(p) { const { error } = await sb.auth.updateUser({ password: p }); if (error) throw error; },
  onRecovery(cb) { sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') cb(); }); },
  async rpc(fn, args = {}) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; },
  async select(table, build) { let q = sb.from(table).select('*'); if (build) q = build(q); const { data, error } = await q; if (error) throw error; return data; },
  async markRead(uid) { await sb.from('notifications').update({ read: true }).eq('user_id', uid).eq('read', false); },
  async updateSettings(v) { const { error } = await sb.from('settings').update(v).eq('id', 1); if (error) throw error; },
  async upload(bucket, path, blob) { const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false }); if (error) throw error; return path; },
  async signed(bucket, path) { const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 600); if (error) throw error; return data.signedUrl; },
  listen(uid, cb) {
    const ch = sb.channel('amp-' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + uid }, p => cb(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => cb(null))
      .subscribe();
    return () => sb.removeChannel(ch);
  }
};
function msg(e) {
  const m = String(e?.message || e || 'Error');
  const t = [
    ['Invalid login credentials', 'Correo o contraseña incorrectos.'],
    ['User already registered', 'Ese correo ya está registrado. Ingresa con tu contraseña.'],
    ['Database error saving new user', 'Ya existe una cuenta con ese DNI o ese celular. Solo se permite una cuenta por persona: ingresa con la tuya o escríbenos.'],
    ['Email not confirmed', 'Confirma tu correo: te enviamos un enlace.'],
    ['Password should be at least', 'La contraseña debe tener al menos 8 caracteres.'],
    ['row-level security', 'No tienes permiso para esa acción.'],
    ['Failed to fetch', 'Sin conexión. Revisa tu internet.'],
    ['The resource already exists', 'Ese archivo ya se subió. Vuelve a intentar.'],
    ['rate limit', 'Demasiados intentos. Espera un minuto.']
  ];
  for (const [k, v] of t) if (m.includes(k)) return v;
  return m.replace(/^.*?ERROR:\s*/, '');
}

/* Reduce la foto a ~150 KB antes de subirla (máx. 1280 px, JPEG) */
async function compress(file) {
  if (!file) throw new Error('Elige una imagen.');
  if (!/^image\//.test(file.type)) throw new Error('El archivo debe ser una imagen (foto o captura).');
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen.')); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1280 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.72));
}

/* ======================= ESTADO ======================= */
const S = {
  user: null, me: null, cfg: null, ents: [], accs: [], mine: [], asAgent: [], market: [], notes: [], ledger: [], wds: [],
  tab: 'home', view: null, auth: 'login', regRole: 'cliente', sheet: null, off: 0, agF: 'top', agSub: null, staffTab: 'recargas', st: {}, draft: null, busy: false
};
const meId = () => S.me?.id;
const isStaff = () => S.me && ['soporte','admin'].includes(S.me.role);
const isAgent = () => S.me?.agent_status === 'activo';
const verified = () => S.me?.kyc_status === 'aprobado';
const held = () => (S.wds || []).filter(w => w.status === 'pendiente' && !w.debited).reduce((a, w) => a + +w.amount, 0);
const avail = () => r2(Math.max(0, +S.me.wallet - held()));
const upper = v => v.toUpperCase().replace(/\s+/g, ' ').trimStart();
const dniNote = `<div class="alert a-warn" style="margin-top:12px"><b>Escribe tus datos en MAYÚSCULAS y tal como aparecen en tu DNI.</b> Si no coinciden con tu DNI, tu cuenta no será verificada. Solo puedes tener una cuenta: tu DNI, celular y correo no se pueden usar dos veces.</div>`;
const pwField = (id, ac) => `<div class="pw"><input id="${id}" type="password" autocomplete="${ac}"><button type="button" class="eye" data-act="eye" data-for="${id}" aria-label="Mostrar contraseña" aria-pressed="false">${ic('eye')}</button></div>`;
const brand = () => `<span class="brand"><img src="logo.png" alt="Agente Móvil"><span class="p2p">P2P</span></span>`;
const now = () => Date.now() + S.off;

async function loadAll() {
  const id = S.user.id;
  const [me] = await api.select('profiles', q => q.eq('id', id));
  S.me = me;
  if (!me) return;
  const [cfg] = await api.select('settings');
  S.cfg = cfg;
  const tasks = [
    api.select('entities', q => q.order('sort')),
    api.select('bank_accounts', q => q.eq('user_id', id).eq('active', true).order('created_at')),
    api.select('orders', q => q.eq('client_id', id).order('created_at', { ascending: false }).limit(60)),
    api.select('orders', q => q.eq('agent_id', id).order('accepted_at', { ascending: false }).limit(60)),
    api.select('notifications', q => q.eq('user_id', id).order('created_at', { ascending: false }).limit(60)),
    api.select('wallet_ledger', q => q.eq('user_id', id).order('at', { ascending: false }).limit(60)),
    api.select('withdrawals', q => q.eq('user_id', id).order('created_at', { ascending: false }).limit(30)),
    api.select('topups', q => q.eq('user_id', id).order('created_at', { ascending: false }).limit(30)),
    api.rpc('server_now')
  ];
  [S.ents, S.accs, S.mine, S.asAgent, S.notes, S.ledger, S.wds, S.tops] = await Promise.all(tasks.slice(0, 8));
  S.off = new Date(await tasks[8]).getTime() - Date.now();
  S.market = await api.rpc('list_market').catch(() => []);
  if (isStaff()) await loadStaff();
}
async function loadStaff() {
  const [sum] = await api.rpc('admin_summary');
  const [deps, cases, wds, kyc, agents, flagged, recent, black, recl, tops, bannedBal] = await Promise.all([
    api.select('orders', q => q.eq('status', 'deposito_revision').order('created_at')),
    api.select('cases', q => q.order('created_at', { ascending: false }).limit(60)),
    api.select('withdrawals', q => q.eq('status', 'pendiente').order('created_at')),
    api.select('profiles', q => q.in('kyc_status', ['en_revision','pendiente']).eq('banned', false).order('created_at')),
    api.select('profiles', q => q.neq('agent_status', 'no').order('created_at', { ascending: false }).limit(100)),
    api.select('bank_accounts', q => q.not('flagged', 'is', null)),
    api.select('orders', q => q.order('created_at', { ascending: false }).limit(80)),
    api.select('blacklist', q => q.order('created_at', { ascending: false }).limit(100)),
    api.select('complaints', q => q.order('created_at', { ascending: false }).limit(100)),
    api.select('topups', q => q.eq('status', 'pendiente').order('created_at')),
    api.select('profiles', q => q.eq('banned', true).order('created_at', { ascending: false }).limit(200))
  ]);
  const caseOrders = cases.length ? await api.select('orders', q => q.in('id', cases.map(c => c.order_id))) : [];
  const people = new Set([...deps.map(o => o.client_id), ...caseOrders.flatMap(o => [o.client_id, o.agent_id]), ...wds.map(w => w.user_id), ...flagged.map(a => a.user_id), ...tops.map(t => t.user_id)].filter(Boolean));
  const profs = people.size ? await api.select('profiles', q => q.in('id', [...people])) : [];
  S.st = { sum, deps, cases, caseOrders, wds, kyc, agents, flagged, recent, black, recl, tops, bannedBal: bannedBal.filter(p => +p.wallet + +p.guarantee > 0), profs: Object.fromEntries(profs.map(p => [p.id, p])) };
}
const ord = id => [...S.mine, ...S.asAgent, ...(S.st.recent || []), ...(S.st.caseOrders || []), ...(S.st.deps || [])].find(o => o.id === +id);

/* ======================= UTILIDADES DE UI ======================= */
let toastT;
function toast(t) {
  document.querySelector('.toast')?.remove();
  const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t;
  document.body.appendChild(d); clearTimeout(toastT); toastT = setTimeout(() => d.remove(), 4200);
}
const val = id => ($('#' + id)?.value || '').trim();
const setErr = (id, t) => { const e = $('#' + id); if (e) e.textContent = t || ''; };
async function run(btn, fn, errId) {
  if (S.busy) return; S.busy = true;
  const old = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = 'Un momento…'; }
  try { await fn(); } catch (e) { const m = msg(e); if (errId && $('#' + errId)) setErr(errId, m); else toast(m); if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  finally { S.busy = false; }
}
async function refresh() { await loadAll(); render(); }
function proofImg(bucket, path, alt) {
  if (!path) return '';
  return `<img class="proof" data-b="${esc(bucket)}" data-p="${esc(path)}" alt="${esc(alt)}">`;
}
const urlCache = {};
async function fillImgs() {
  for (const im of document.querySelectorAll('img[data-p]:not([src])')) {
    const k = im.dataset.b + '/' + im.dataset.p;
    try { urlCache[k] = urlCache[k] || await api.signed(im.dataset.b, im.dataset.p); im.src = urlCache[k]; } catch { im.alt = 'No se pudo cargar la imagen'; }
  }
}
function timerBox(deadline, minutes, label, ent) {
  const down = S.ents.find(e => e.name === ent)?.down;
  return `<div class="card dark"><div class="row"><span class="mut">${label}</span><span class="clock" data-dl="${esc(deadline)}">--:--</span></div>
  <div class="bar"><i data-dlb="${esc(deadline)}" data-min="${minutes}"></i></div>
  ${down ? `<p class="mut" style="color:#ffb3ae;margin:8px 0 0">Reloj en pausa: ${esc(ent)} reporta caída de servicio.</p>` : ''}</div>`;
}
function updClocks() {
  for (const e of document.querySelectorAll('[data-dl]')) {
    const s = Math.max(0, Math.round((new Date(e.dataset.dl).getTime() - now()) / 1000));
    e.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  for (const e of document.querySelectorAll('[data-dlb]')) {
    const s = Math.max(0, (new Date(e.dataset.dlb).getTime() - now()) / 1000);
    e.style.width = Math.min(100, s / (e.dataset.min * 60) * 100) + '%';
  }
}
function tline(o, events) {
  if (!events) return `<p class="mut" data-events="${o.id}">Cargando movimientos…</p>`;
  return `<h3 style="margin-top:20px">Movimientos</h3><ul class="tl">${events.map(e => `<li><time>${hm(e.at)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>`;
}
const evCache = {};
async function fillEvents() {
  for (const p of document.querySelectorAll('[data-events]')) {
    const id = +p.dataset.events;
    try { evCache[id] = await api.select('order_events', q => q.eq('order_id', id).order('at', { ascending: false })); p.outerHTML = tline({ id }, evCache[id]); } catch {}
  }
}

/* ======================= PANTALLAS: ACCESO ======================= */
function vAuth() {
  const a = S.auth;
  const form = a === 'login' ? `
    <label class="f" for="l-email">Correo</label><input id="l-email" type="email" autocomplete="email" inputmode="email">
    <label class="f" for="l-pass">Contraseña</label>${pwField('l-pass','current-password')}
    <p class="err" id="l-err"></p>
    <button class="btn" data-act="login">Ingresar</button>
    <button class="lnk" data-act="auth" data-v="forgot">Olvidé mi contraseña</button>`
  : a === 'forgot' ? `
    <p class="mut">Te enviaremos un enlace a tu correo para crear una contraseña nueva.</p>
    <label class="f" for="f-email">Correo</label><input id="f-email" type="email" autocomplete="email">
    <p class="err" id="f-err"></p>
    <button class="btn" data-act="forgot">Enviar enlace</button>
    <button class="lnk" data-act="auth" data-v="login">Volver a ingresar</button>`
  : a === 'newpass' ? `
    <h2>Crea tu contraseña nueva</h2>
    <label class="f" for="n-pass">Contraseña nueva (mínimo 8)</label>${pwField('n-pass','new-password')}
    <p class="err" id="n-err"></p><button class="btn" data-act="newpass">Guardar</button>`
  : `
    <p class="f" style="font-weight:600;font-size:14px;margin:14px 0 0">¿Cómo quieres usar Agente Móvil?</p>
    <div class="pick" role="group" aria-label="Tipo de cuenta">
      <button type="button" data-act="regrole" data-v="cliente" aria-pressed="${S.regRole === 'cliente'}"><b>Cliente</b><span>Muevo mi dinero entre mis cuentas</span></button>
      <button type="button" data-act="regrole" data-v="agente" aria-pressed="${S.regRole === 'agente'}"><b>Agente</b><span>Transfiero con mi saldo y gano comisiones</span></button>
    </div>
    ${S.regRole === 'agente' ? '<p class="mut" style="margin:8px 0 0">Podrás ver las órdenes apenas entres. Para aceptarlas, soporte debe verificar tu identidad.</p>' : ''}
    ${dniNote}
    <label class="f" for="r-name">NOMBRES Y APELLIDOS (como en tu DNI)</label><input id="r-name" autocomplete="name" autocapitalize="characters" style="text-transform:uppercase" placeholder="EJ. LUIS ALBERTO CHÁVEZ RAMOS">
    <div class="grid2"><div><label class="f" for="r-dni">DNI</label><input id="r-dni" inputmode="numeric" maxlength="8"></div>
    <div><label class="f" for="r-phone">Celular</label><input id="r-phone" inputmode="tel" maxlength="9" autocomplete="tel"></div></div>
    <label class="f" for="r-dept">Departamento</label><select id="r-dept"><option value="">Elige…</option>${DEPTS.map(d => `<option>${d}</option>`).join('')}</select>
    <label class="f" for="r-email">Correo</label><input id="r-email" type="email" autocomplete="email">
    <label class="f" for="r-pass">Contraseña (mínimo 8)</label>${pwField('r-pass','new-password')}
    <label class="chk"><input type="checkbox" id="r-tc"><span>Acepto los <a href="../terminos.html" target="_blank" rel="noopener">Términos y condiciones</a> y la <a href="../privacidad.html" target="_blank" rel="noopener">Política de privacidad</a>. Entiendo que solo puedo mover dinero entre cuentas a mi nombre.</span></label>
    <p class="err" id="r-err"></p>
    <button class="btn" data-act="register">${S.regRole === 'agente' ? 'Crear mi cuenta de agente' : 'Crear mi cuenta'}</button>`;
  return `<div class="hero">${brand()}<p>Mueve tu dinero entre tus cuentas de cualquier banco o caja del Perú, con agentes verificados.</p></div>
  <div class="wrap" style="margin-top:-50px;padding-bottom:40px"><div class="card">
  ${a === 'login' || a === 'register' ? `<div class="seg" role="tablist"><button role="tab" aria-selected="${a === 'login'}" data-act="auth" data-v="login">Ingresar</button><button role="tab" aria-selected="${a === 'register'}" data-act="auth" data-v="register">Crear cuenta</button></div>` : ''}
  ${form}</div></div>`;
}

/* ======================= PANTALLAS: IDENTIDAD ======================= */
function vBlocked() {
  return `<div class="wrap"><div class="card" style="text-align:center"><h1>Cuenta bloqueada</h1>
  <p>${esc(S.me.ban_reason || 'Por seguridad de la plataforma.')}</p>
  <p class="mut">Tu DNI y tu rostro quedaron en la lista negra de Agente Móvil. Si tienes saldo, soporte se comunicará contigo para devolvértelo.</p>
  <button class="btn o" data-act="logout">Cerrar sesión</button></div></div>`;
}
function verifyBanner() {
  const m = S.me; if (verified() || isStaff()) return '';
  if (m.kyc_status === 'en_revision') return `<div class="alert a-info"><b>Estamos revisando tu identidad.</b> Mientras tanto puedes ver la app, pero no realizar operaciones.</div>`;
  return `<div class="alert a-warn"><b>Tu cuenta aún no está verificada.</b> Puedes ver la app y las órdenes publicadas, pero no realizar operaciones.${m.kyc_status === 'rechazado' ? ' Tu verificación anterior fue rechazada.' : ''}
    <button class="btn y" style="margin-top:8px" data-act="kycview">Verificar mi identidad</button></div>`;
}
function vKyc() {
  const m = S.me;
  if (m.kyc_status === 'en_revision') return `${back(S.tab)}<div class="card"><h1>Estamos revisando tu identidad</h1>
    <p>Soporte compara la foto de tu DNI con tu selfie. Normalmente toma menos de un día hábil. Te llegará un aviso.</p>
    <p class="mut">DNI ${mask(m.dni)} · ${esc(m.full_name)}</p>
    <button class="btn o" data-act="refresh">Actualizar</button></div>`;
  return `${back(S.tab)}<div class="card"><h1>Verifica tu identidad</h1>
  <p class="mut">Es obligatorio para clientes y agentes. Así nadie puede usar tu nombre ni mover dinero de terceros.</p>
  ${m.kyc_status === 'rechazado' ? `<div class="alert a-bad"><b>Tu verificación fue rechazada.</b> ${esc(m.kyc_note || 'Sube fotos más claras.')}</div>` : ''}
  ${dniNote}
  <label class="f" for="k-name">NOMBRES Y APELLIDOS (como en tu DNI)</label><input id="k-name" autocapitalize="characters" style="text-transform:uppercase" value="${esc(m.full_name)}">
  <label class="f" for="k-dni">DNI</label><input id="k-dni" inputmode="numeric" maxlength="8" value="${esc(m.dni || '')}">
  <label class="f" for="k-doc">Foto de tu DNI (lado de la foto, que se lea todo)</label><input id="k-doc" type="file" accept="image/*" capture="environment">
  <label class="f" for="k-self">Selfie sosteniendo tu DNI junto a tu cara</label><input id="k-self" type="file" accept="image/*" capture="user">
  <p class="mut">Las fotos se guardan cifradas y solo las ve el equipo de soporte.</p>
  <p class="err" id="k-err"></p>
  <button class="btn" data-act="kyc">Enviar para verificación</button></div>`;
}

/* ======================= PANTALLAS: CLIENTE ======================= */
function oRow(o, act) {
  const [l, c] = ST[o.status];
  return `<button class="it" data-act="${act}" data-id="${o.id}"><b>${esc(o.dest_entity)} <span class="mut">${tail(o.dest_number)}</span></b><b class="num">${money(o.amount)}</b>
  <span class="mut">${esc(o.code)} · ${when(o.created_at)}</span><span><span class="tag ${c}">${l}</span></span></button>`;
}
function walletCard() {
  const h = held(), g = +S.me.guarantee || 0;
  return `<div class="card dark"><span class="mut">Saldo virtual disponible</span><div class="big num">${money(avail())}</div>
  ${h ? `<span class="mut">${money(h)} reservados para un retiro en proceso.</span><br>` : ''}
  ${isAgent() || S.me.agent_status === 'solicitado' || g ? `<span class="mut">Garantía de agente: <b class="num" style="color:#fff">${money(g)}</b></span><br>` : ''}
  <span class="mut">Recarga, mueve tu dinero o retíralo cuando quieras.</span></div>`;
}
function vTopup() {
  const c = S.cfg, ready = c.company_account && c.company_account !== 'POR-CONFIGURAR';
  const list = S.tops || [];
  return `${back('home')}<h1>Recargar saldo</h1>${verifyBanner()}
  <p class="mut">Transfiere a la cuenta de la empresa. Cuando soporte confirme que el dinero llegó, verás el mismo monto en tu saldo virtual.</p>
  ${ready ? `<div class="acct"><div class="k">Cuenta ${esc(c.company_bank)} de ${esc(c.company_holder)}</div><div class="v">${esc(c.company_account)}</div>
  ${c.company_cci ? `<div class="k" style="margin-top:6px">CCI ${esc(c.company_cci)}</div>` : ''}</div>
  <button class="btn o" data-act="copy" data-v="${esc(c.company_account)}">Copiar número de cuenta</button>
  <div class="alert a-warn">Transfiere solo desde una cuenta a tu nombre (${esc(S.me.full_name)}). Si el titular es otra persona, rechazamos la recarga y devolvemos el dinero a su origen.</div>
  <label class="f" for="t-amt">Monto que transferiste (S/)</label><input id="t-amt" type="number" inputmode="decimal" min="10" step="0.01">
  <label class="f" for="t-code">Código de operación</label><input id="t-code" inputmode="numeric" autocomplete="off" placeholder="Ej. 06128833">
  <label class="f" for="t-file">Captura de la constancia</label><input id="t-file" type="file" accept="image/*">
  <p class="err" id="t-err"></p>
  <button class="btn" data-act="sendtopup" ${verified() ? '' : 'disabled'}>Ya transferí: validar mi recarga</button>`
  : `<div class="alert a-info">Las recargas estarán disponibles muy pronto.</div>`}
  ${list.length ? `<h2 class="sec">Mis recargas</h2><div class="card"><div class="list">${list.map(t => `<div class="it" style="cursor:default"><b class="num">${money(t.amount)}</b><span class="tag ${t.status === 'aprobada' ? 't-ok' : t.status === 'rechazada' ? 't-bad' : 't-warn'}">${t.status === 'aprobada' ? 'Acreditada' : t.status === 'rechazada' ? 'Rechazada' : 'En validación'}</span><span class="mut">op. ${esc(t.op_code)} · ${when(t.created_at)}</span><span class="mut">${esc(t.note || '')}</span></div>`).join('')}</div></div>` : ''}`;
}
function vHome() {
  const live = S.mine.filter(o => LIVE.includes(o.status)), past = S.mine.filter(o => !LIVE.includes(o.status));
  return `<h1>Hola, ${esc(S.me.full_name.split(' ')[0])}</h1>${verifyBanner()}
  ${walletCard()}
  <div class="grid2"><button class="btn y" data-act="topup">${ic('plus')} Recargar saldo</button><button class="btn" data-act="new">${ic('send')} Mover mi dinero</button></div>
  ${(S.tops || []).filter(t => t.status === 'pendiente').length ? `<div class="alert a-info"><b>Recarga en validación:</b> ${S.tops.filter(t => t.status === 'pendiente').map(t => money(t.amount)).join(', ')}. Aparecerá en tu saldo cuando soporte confirme que llegó.</div>` : ''}
  ${S.market.filter(o => !o.is_mine).length ? `<button class="it card" style="display:grid" data-act="tab" data-v="agent"><b>${S.market.filter(o => !o.is_mine).length} órdenes publicadas en el Perú</b><span>Ver →</span><span class="mut" style="grid-column:1/-1">Mira lo que otros usuarios están moviendo ahora.</span></button>` : ''}
  ${live.length ? `<h2 class="sec">En curso</h2><div class="card"><div class="list">${live.map(o => oRow(o, 'open')).join('')}</div></div>` : ''}
  <h2 class="sec">Historial</h2>${past.length ? `<div class="card"><div class="list">${past.slice(0, 20).map(o => oRow(o, 'open')).join('')}</div></div>` : '<p class="empty">Aún no tienes operaciones terminadas.</p>'}`;
}
function vNew() {
  const c = S.cfg, d = S.draft;
  const dests = S.accs.filter(a => !a.flagged);
  if (!dests.some(a => a.id === d.acc)) d.acc = dests[0]?.id || null;
  if (!S.accs.length) return `${back('home')}<h1>Mover mi dinero</h1><div class="alert a-info">Primero registra las cuentas a tu nombre donde quieres recibir tu dinero.</div><button class="btn" data-act="tab" data-v="account">Registrar mis cuentas</button>`;
  return `${back('home')}<h1>Mover mi dinero</h1>
  <p class="mut">Se paga con tu saldo virtual. Un agente con saldo en la entidad de destino te transfiere a tu cuenta y tú confirmas cuando llegue.</p>
  <div class="card"><div class="row"><span>Tu saldo disponible</span><b class="num">${money(avail())}</b></div>
  <button class="btn y sm" style="margin-top:8px" data-act="topup">Recargar saldo</button></div>
  <label class="f" for="d-acc">Hacia mi cuenta</label>
  <select id="d-acc">${dests.map(a => `<option value="${a.id}"${a.id === d.acc ? ' selected' : ''}>${esc(a.entity)} ${tail(a.number)}</option>`).join('')}</select>
  <label class="f" for="d-amt">Monto (de ${money(c.min_amount)} a ${money(c.max_amount)})</label>
  <input id="d-amt" type="number" inputmode="decimal" min="${c.min_amount}" max="${c.max_amount}" step="10" value="${d.amount}">
  <label class="f" for="d-pct">Comisión que ofreces: <span id="d-pctv">${pctS(d.pct)}</span></label>
  <input id="d-pct" type="range" min="${c.default_pct}" max="${c.max_pct}" step="0.05" value="${d.pct}">
  <p class="mut" style="margin:0">${pctS(c.default_pct)} es la tarifa base. Si tienes urgencia, súbela: mientras más alta, más arriba te ven los agentes.</p>
  <div class="sum" id="d-sum"></div>
  <p class="err" id="d-err"></p>
  <button class="btn" data-act="create">Publicar mi orden</button>`;
}
function updSum() {
  const el = $('#d-sum'); if (!el) return;
  const c = S.cfg, d = S.draft, amt = +d.amount || 0, fee = r2(amt * d.pct / 100), ag = r2(fee * c.agent_share);
  $('#d-pctv').textContent = pctS(d.pct);
  el.innerHTML = `<div class="row"><span>Monto que llega a tu cuenta</span><b class="num">${money(amt)}</b></div>
  <div class="row"><span>Comisión (${pctS(d.pct)})</span><b class="num">${money(fee)}</b></div>
  <div class="row mut"><span>Para el agente</span><span class="num">${money(ag)}</span></div>
  <div class="row mut"><span>Para Agente Móvil</span><span class="num">${money(fee - ag)}</span></div>
  <div class="row tot"><span>Se descuenta de tu saldo</span><span class="num">${money(amt + fee)}</span></div>
  ${amt + fee > avail() ? `<p class="err" style="margin:8px 0 0">Tu saldo disponible (${money(avail())}) no alcanza. Recarga saldo primero.</p>` : ''}`;
}
const back = (tab, view = null) => `<button class="lnk" data-act="go" data-tab="${tab}" data-view="${view || ''}">← Volver</button>`;

function vOrder(o) {
  const c = S.cfg, [l, cls] = ST[o.status];
  let b = '';
  if (o.status === 'deposito_pendiente') b = `
    <h2 class="sec">Deposita para publicar tu orden</h2>
    <p class="mut">Los agentes solo ven órdenes con el dinero ya en custodia.</p>
    <div class="acct"><div class="k">Transfiere exactamente</div><div class="v num">${money(o.total)}</div>
    <div class="k" style="margin-top:10px">A la cuenta ${esc(c.company_bank)} de ${esc(c.company_holder)}</div><div class="v">${esc(c.company_account)}</div>
    ${c.company_cci ? `<div class="k" style="margin-top:6px">CCI ${esc(c.company_cci)}</div>` : ''}</div>
    <button class="btn o" data-act="copy" data-v="${esc(c.company_account)}">Copiar número de cuenta</button>
    <div class="alert a-warn">Solo desde tu cuenta ${esc(c.company_bank)} a tu nombre. Si el titular no es ${esc(S.me.full_name)}, rechazamos el depósito y lo devolvemos a su origen.</div>
    <label class="f" for="dp-code">Código de operación de tu transferencia</label><input id="dp-code" inputmode="numeric" autocomplete="off" placeholder="Ej. 06128833">
    <label class="f" for="dp-file">Captura de la constancia</label><input id="dp-file" type="file" accept="image/*">
    <p class="err" id="dp-err"></p>
    <button class="btn" data-act="deposit" data-id="${o.id}">Ya transferí</button>
    <button class="btn o" data-act="cancel" data-id="${o.id}">Cancelar orden</button>`;
  if (o.status === 'deposito_revision') b = `<div class="alert a-warn"><b>Validando tu depósito.</b> Soporte confirma que llegó a la cuenta de la empresa y que el titular eres tú. Luego se publica tu orden.</div>${proofImg('comprobantes', o.deposit_proof, 'Tu constancia de depósito')}`;
  if (o.status === 'publicada') b = `<div class="alert a-info"><b>Buscando agente.</b> ${money(o.total)} están en custodia en Agente Móvil.</div><button class="btn o" data-act="cancel" data-id="${o.id}">Cancelar y devolver a mi saldo</button>`;
  if (o.status === 'aceptada') b = timerBox(o.agent_deadline, c.agent_minutes, 'El agente tiene para transferir', o.dest_entity) + `<p class="mut">Si no transfiere a tiempo, el dinero vuelve a tu saldo virtual.</p>`;
  if (o.status === 'confirmacion') b = timerBox(o.client_deadline, c.client_minutes, 'Confirma antes de', o.dest_entity) + `
    <p><b>El agente dice que ya transfirió.</b> Revisa tu cuenta ${esc(o.dest_entity)} ${tail(o.dest_number)} en tu banca móvil.</p>
    <div class="card"><div class="row"><span class="mut">Código de operación</span><b class="num">${esc(o.voucher_code)}</b></div>${proofImg('comprobantes', o.voucher_path, 'Voucher del agente')}</div>
    <button class="btn" data-act="ok" data-id="${o.id}">${ic('check')} Ya llegó a mi cuenta</button>
    <button class="btn y" data-act="notyet" data-id="${o.id}">Aún no llega</button>
    <button class="btn r" data-act="fake" data-id="${o.id}">${ic('warn')} El voucher es falso</button>
    <p class="mut">Si no respondes a tiempo, soporte verifica el código con ${esc(o.dest_entity)} antes de liberar el dinero, y su decisión es final.</p>`;
  if (o.status === 'revision') b = `<div class="alert a-warn"><b>En revisión.</b> Soporte verifica el código de operación con ${esc(o.dest_entity)}. Tu dinero sigue en custodia.</div>`;
  if (o.status === 'completada') b = `<div class="alert a-ok"><b>Listo.</b> ${money(o.amount)} llegaron a tu cuenta ${esc(o.dest_entity)}.</div>`;
  if (o.status === 'reembolsada') b = `<div class="alert a-info"><b>${money(o.total)} volvieron a tu saldo virtual.</b> Puedes volver a publicar sin depositar de nuevo.</div><button class="btn" data-act="retry" data-id="${o.id}">Volver a solicitar envío</button>`;
  if (o.status === 'cancelada') b = `<div class="alert a-info">Cancelaste esta orden.</div>`;
  if (o.status === 'rechazada') b = `<div class="alert a-bad"><b>Depósito rechazado.</b> No encontramos tu depósito o vino de una cuenta que no está a tu nombre. Si el dinero llegó, se devuelve a la cuenta de origen.</div>`;
  return `${back('home')}<div class="row"><h1>${esc(o.code)}</h1><span class="tag ${cls}">${l}</span></div>
  <div class="card"><div class="row"><span class="mut">Hacia</span><b>${esc(o.dest_entity)} ${tail(o.dest_number)}</b></div>
  <div class="row"><span class="mut">Monto</span><b class="num">${money(o.amount)}</b></div>
  <div class="row"><span class="mut">Comisión</span><span class="num">${money(o.fee)} (${pctS(o.pct)})</span></div></div>
  ${b}${tline(o, null)}`;
}

/* ======================= PANTALLAS: AGENTE ======================= */
function oCard(o, can) {
  let act;
  if (o.is_mine) act = `<span class="tag t-info">Tu orden</span>`;
  else if (!isAgent()) act = '';
  else { const gOk = +S.me.guarantee >= +o.amount;
    act = `<button class="btn ${o.has_account && gOk ? '' : 'o'}" data-act="take" data-id="${o.id}" ${can && o.has_account && gOk ? '' : 'disabled'}>${!o.has_account ? 'Necesitas cuenta en ' + esc(o.dest_entity) : !gOk ? 'Tu garantía no alcanza (' + money(S.me.guarantee) + ')' : 'Aceptar orden'}</button>`; }
  return `<div class="oc"><div class="row"><b style="font:800 17px Archivo,Inter,sans-serif">${esc(o.dest_entity)}</b><span class="pct">${pctS(o.pct)}</span></div>
  <div class="am num">${money(o.amount)}</div>
  <div class="mut">${esc(o.client_short)}${o.client_dept ? ' · ' + esc(o.client_dept) : ''} · publicada ${hm(o.published_at)}</div>
  <div class="row" style="margin-top:6px"><span>El agente gana <b class="num">${money(o.agent_fee)}</b></span>${isAgent() && !o.is_mine ? (o.has_account ? '<span class="tag t-ok">Tienes cuenta aquí</span>' : '<span class="tag t-mute">Sin cuenta aquí</span>') : ''}</div>
  ${act}</div>`;
}
function vAgent() {
  const m = S.me, c = S.cfg;
  const cur = S.asAgent.find(o => ['aceptada','confirmacion','revision'].includes(o.status));
  const susp = m.suspended_until && new Date(m.suspended_until).getTime() > now();
  const can = isAgent() && verified() && !S.asAgent.some(o => o.status === 'aceptada') && !susp;
  let head = verifyBanner();
  if (verified()) {
    if (m.agent_status === 'no') head += `<div class="alert a-info"><b>Estás viendo las órdenes como cliente.</b> Si tienes saldo en un banco o caja, hazte agente: te devolvemos lo que transfieres más el ${Math.round(c.agent_share * 100)}% de la comisión.<button class="btn" style="margin-top:8px" data-act="beagent">Quiero ser agente</button></div>`;
    if (m.agent_status === 'solicitado') head += `<div class="alert a-info"><b>Tu solicitud de agente está en revisión.</b> Te avisaremos cuando puedas aceptar órdenes.</div>`;
    if (m.agent_status === 'retirado') head += `<div class="alert a-bad">Perdiste el rol de agente por acumular ${c.strikes_max} strikes. Puedes seguir usando la app como cliente.</div>`;
  } else if (m.agent_status === 'solicitado') head += `<p class="mut">Te registraste como agente. Cuando soporte confirme tu identidad podrás aceptar órdenes.</p>`;
  if (cur) head += `<button class="it card" style="display:grid" data-act="aopen" data-id="${cur.id}"><b>Orden en curso: ${esc(cur.code)}</b><span class="tag ${ST[cur.status][1]}">${ST[cur.status][0]}</span><span class="mut">${esc(cur.dest_entity)} · ${money(cur.amount)}</span><span>Abrir →</span></button>`;
  if (susp) head += `<div class="alert a-bad"><b>Suspendido por strike ${m.strikes}/${c.strikes_max}.</b> Vuelves a tomar órdenes el ${when(m.suspended_until)}.</div>`;
  if (isAgent() && verified()) head += `<div class="alert ${+m.guarantee > 0 ? 'a-info' : 'a-warn'}"><b>Tu garantía: ${money(m.guarantee)}.</b> ${+m.guarantee > 0 ? 'Puedes aceptar órdenes de hasta ese monto.' : 'Para aceptar órdenes, pon saldo en garantía: solo puedes aceptar órdenes de hasta ese monto.'} <button class="lnk" data-act="tab" data-v="wallet">Gestionar garantía</button></div>`;
  if (isAgent() && verified() && !S.accs.length) head += `<div class="alert a-warn">Registra tus cuentas en <b>Cuenta</b> para poder aceptar órdenes de esas entidades.</div>`;
  const all = S.market, f = S.agF, sub = S.agSub, ents = S.ents;
  const list = all.filter(o => f === 'top' || (f === 'cajas' ? (sub ? o.dest_entity === sub : ents.find(e => e.name === o.dest_entity)?.kind === 'caja') : o.dest_entity === f));
  const banks = ents.filter(e => e.kind === 'banco').map(e => e.name);
  const done = S.asAgent.filter(o => !['aceptada','confirmacion','revision'].includes(o.status));
  return `<div class="row"><h1>Órdenes publicadas</h1><button class="btn o sm" data-act="refresh">Actualizar</button></div>
  <p class="mut" style="margin:4px 0 0">${all.length} ${all.length === 1 ? 'orden pendiente' : 'órdenes pendientes'} de realizarse en todo el Perú. ${isAgent() && verified() ? 'Acepta las de entidades donde tienes saldo.' : 'Solo los agentes verificados pueden aceptarlas.'}</p>${head}
  ${all.length ? `<div class="hot"><h2>Las más rentables</h2>${all.slice(0, 3).map(o => oCard(o, can)).join('')}</div>` : ''}
  <h2 class="sec">Por entidad</h2>
  <div class="chips" role="group" aria-label="Filtrar por entidad">${[['top','Todas'], ...banks.map(b => [b, b.replace('Banco de la Nación','B. Nación')]), ['cajas','Cajas']].map(([v, t]) => `<button class="chip" data-act="agf" data-v="${esc(v)}" aria-pressed="${f === v}">${esc(t)}</button>`).join('')}</div>
  ${f === 'cajas' ? `<div class="chips">${ents.filter(e => e.kind === 'caja').map(e => `<button class="chip" data-act="agsub" data-v="${esc(e.name)}" aria-pressed="${sub === e.name}">${esc(e.name.replace('Caja ', ''))}</button>`).join('')}</div>` : ''}
  ${list.length ? list.map(o => oCard(o, can)).join('') : '<p class="empty">No hay órdenes pendientes para esta entidad ahora.</p>'}
  ${done.length ? `<h2 class="sec">Mis órdenes atendidas</h2><div class="card"><div class="list">${done.slice(0, 20).map(o => oRow(o, 'aopen')).join('')}</div></div>` : ''}`;
}
function vAgentOrder(o) {
  const c = S.cfg, [l, cls] = ST[o.status];
  let b = '';
  if (o.status === 'aceptada') b = timerBox(o.agent_deadline, c.agent_minutes, 'Tiempo para subir el voucher', o.dest_entity) + `
    <div class="card"><p class="mut" style="margin:0">1. Desde tu app de ${esc(o.dest_entity)} transfiere exactamente</p><div class="big num">${money(o.amount)}</div>
    <p class="mut" style="margin:10px 0 0">2. A esta cuenta</p><div class="row"><b>${esc(o.dest_entity)}</b><b class="num">${esc(o.dest_number)}</b></div>
    <div class="row"><span>Titular: <b>${esc(o.dest_holder)}</b></span></div>
    <button class="btn o sm" style="margin-top:8px" data-act="copy" data-v="${esc(o.dest_number)}">Copiar número</button></div>
    <div class="alert a-warn">Si tu banca muestra otro titular, <b>no transfieras</b>: usa "El titular no coincide".</div>
    <label class="f" for="v-code">3. Código de operación</label><input id="v-code" inputmode="numeric" autocomplete="off" placeholder="Como aparece en tu voucher">
    <label class="f" for="v-file">4. Captura del voucher</label><input id="v-file" type="file" accept="image/*">
    <p class="err" id="v-err"></p>
    <button class="btn" data-act="voucher" data-id="${o.id}">Enviar comprobante</button>
    <button class="btn o" data-act="mismatch" data-id="${o.id}">El titular no coincide</button>
    <button class="btn o" data-act="giveup" data-id="${o.id}">No puedo hacerla (suma 1 strike)</button>
    <p class="mut">Cuando el cliente confirme recibirás ${money(+o.amount + +o.agent_fee)} en tu saldo.</p>`;
  if (o.status === 'confirmacion') b = timerBox(o.client_deadline, c.client_minutes, 'El cliente tiene para confirmar', o.dest_entity)
    + (o.not_arrived ? `<div class="alert a-warn">El cliente marcó "Aún no llega" ${o.not_arrived} ${o.not_arrived > 1 ? 'veces' : 'vez'}. Revisa que tu transferencia salió bien.</div>` : '')
    + `<div class="card"><div class="row"><span class="mut">Tu código</span><b class="num">${esc(o.voucher_code)}</b></div>${proofImg('comprobantes', o.voucher_path, 'Tu voucher')}</div>
    <p class="mut">Si el cliente no responde, soporte verifica tu código con ${esc(o.dest_entity)} y te libera el dinero si la transferencia es real.</p>`;
  if (o.status === 'revision') b = `<div class="alert a-warn"><b>En revisión de soporte.</b> Verifican tu código con ${esc(o.dest_entity)}.</div>`;
  if (o.status === 'completada') b = `<div class="alert a-ok"><b>Ganaste ${money(o.agent_fee)}.</b> Se acreditaron ${money(+o.amount + +o.agent_fee)} en tu saldo.</div>`;
  if (o.status === 'reembolsada') b = `<div class="alert a-info">La orden se canceló y el dinero volvió al cliente.</div>`;
  return `${back('agent')}<div class="row"><h1>${esc(o.code)}</h1><span class="tag ${cls}">${l}</span></div>${b}${tline(o, null)}`;
}

/* ======================= BILLETERA, CUENTA, AVISOS ======================= */
function vWallet() {
  const accs = S.accs.filter(a => !a.flagged), av = avail(), g = +S.me.guarantee || 0;
  const agentish = isAgent() || S.me.agent_status === 'solicitado' || g > 0;
  return `<h1>Billetera</h1>${verifyBanner()}
  ${walletCard()}
  <button class="btn y" data-act="topup">${ic('plus')} Recargar saldo</button>
  ${agentish ? `<div class="card"><h3>Garantía de agente</h3>
    <p class="mut" style="margin:6px 0 0">Solo puedes aceptar órdenes de hasta el monto de tu garantía. Puedes liberarla a tu saldo cuando no tengas órdenes en curso.</p>
    <div class="row" style="margin-top:10px"><span>Garantía actual</span><b class="num">${money(g)}</b></div>
    <label class="f" for="g-amt">Monto</label><input id="g-amt" type="number" inputmode="decimal" step="0.01" min="0">
    <p class="err" id="g-err"></p>
    <div class="grid2"><button class="btn" data-act="gadd" ${av > 0 ? '' : 'disabled'}>Pasar de mi saldo a garantía</button><button class="btn o" data-act="grel" ${g > 0 ? '' : 'disabled'}>Liberar garantía a mi saldo</button></div></div>` : ''}
  ${av > 0 && accs.length ? `<div class="card"><h3>Retirar a mi cuenta</h3>
    <label class="f" for="w-acc">Cuenta registrada a tu nombre</label><select id="w-acc">${accs.map(a => `<option value="${a.id}">${esc(a.entity)} ${tail(a.number)}</option>`).join('')}</select>
    <label class="f" for="w-amt">Monto</label><input id="w-amt" type="number" inputmode="decimal" step="0.01" value="${av.toFixed(2)}">
    <p class="err" id="w-err"></p><button class="btn" data-act="withdraw">Solicitar retiro</button>
    <p class="mut">Soporte transfiere a tu cuenta. El monto se descuenta de tu saldo automáticamente cuando soporte confirma el pago; mientras tanto queda reservado.</p></div>` : av > 0 ? `<div class="alert a-info">Para retirar, registra una cuenta a tu nombre en <b>Cuenta</b>.</div>` : ''}
  ${S.wds.length ? `<h2 class="sec">Retiros</h2><div class="card"><div class="list">${S.wds.map(w => `<div class="it" style="cursor:default"><b>${esc(w.entity)} ${tail(w.number)}</b><b class="num">${money(w.amount)}</b><span class="mut">${when(w.created_at)}${w.paid_code ? ' · op. ' + esc(w.paid_code) : ''}</span><span><span class="tag ${w.status === 'pagado' ? 't-ok' : w.status === 'rechazado' ? 't-bad' : 't-warn'}">${w.status === 'pagado' ? 'Pagado' : w.status === 'rechazado' ? 'Rechazado' : 'En proceso'}</span></span></div>`).join('')}</div></div>` : ''}
  <h2 class="sec">Movimientos</h2>${S.ledger.length ? `<div class="card"><div class="list">${S.ledger.map(l => `<div class="it" style="cursor:default"><span>${esc(l.note || l.kind)}</span><b class="num">${+l.amount > 0 ? '+' : ''}${money(l.amount)}</b><span class="mut">${when(l.at)}</span><span class="mut num">Saldo ${money(l.balance)}</span></div>`).join('')}</div></div>` : '<p class="empty">Sin movimientos todavía.</p>'}`;
}
function vAccount() {
  const m = S.me, c = S.cfg;
  return `<h1>Mi cuenta</h1>
  ${verifyBanner()}<div class="card"><div class="row"><b>${esc(m.full_name)}</b>${verified() ? '<span class="tag t-ok">Verificado</span>' : m.kyc_status === 'en_revision' ? '<span class="tag t-warn">En revisión</span>' : '<span class="tag t-warn">Sin verificar</span>'}</div>
  <div class="row mut"><span>DNI</span><span class="num">${mask(m.dni)}</span></div><div class="row mut"><span>Correo</span><span>${esc(m.email)}</span></div>
  <div class="row mut"><span>Rol</span><span>${m.role === 'admin' ? 'Administrador' : m.role === 'soporte' ? 'Soporte' : isAgent() ? 'Cliente y agente' : m.agent_status === 'solicitado' ? 'Agente (por verificar)' : 'Cliente'}</span></div>
  ${isAgent() || m.strikes ? `<div class="row mut" style="margin-top:10px"><span>Strikes</span><span>${m.strikes} de ${c.strikes_max}</span></div><div class="stk">${Array.from({length: c.strikes_max}, (_, i) => `<i class="${i < m.strikes ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div>
  <h2 class="sec">Mis cuentas</h2>
  <p class="mut" style="margin:0">Solo cuentas a tu nombre. El agente ve el titular al transferir: si no eres tú, la orden se cancela y la cuenta queda observada.</p>
  <div class="card"><div class="list">${S.accs.length ? S.accs.map(a => `<div class="it" style="cursor:default"><b>${esc(a.entity)}</b><button class="lnk" style="min-height:auto;padding:0" data-act="rmacc" data-id="${a.id}">Quitar</button><span class="mut num">${esc(a.number)}</span><span>${a.flagged ? `<span class="tag t-bad">Observada</span>` : `<span class="tag ${verified() ? 't-ok' : 't-mute'}">${verified() ? 'A tu nombre' : 'Por verificar'}</span>`}</span></div>`).join('') : '<p class="empty">Aún no registras cuentas.</p>'}</div>
  <label class="f" for="a-ent">Entidad</label><select id="a-ent">${S.ents.map(e => `<option>${esc(e.name)}</option>`).join('')}</select>
  <label class="f" for="a-num">Número de cuenta</label><input id="a-num" inputmode="numeric" autocomplete="off">
  <p class="err" id="a-err"></p><button class="btn o" data-act="addacc">Agregar cuenta</button></div>
  <h2 class="sec">Reglas que aceptaste</h2>
  <div class="card mut"><ul style="margin:0;padding-left:18px">
  <li>Solo mueves dinero entre cuentas a tu nombre.</li>
  <li>Depositas solo desde tu cuenta ${esc(c.company_bank)} a la cuenta ${esc(c.company_bank)} de la empresa.</li>
  <li>Cuando el agente sube el voucher tienes ${c.client_minutes} minutos para responder. Si no respondes, soporte verifica con la entidad y decide.</li>
  <li>Denunciar como falso un voucher real bloquea tu cuenta para siempre.</li>
  <li>Límite actual: ${money(c.max_amount)} por operación.</li></ul></div>
  <h2 class="sec">Información</h2>
  <div class="card"><div class="list">
    <a class="it" href="../index.html"><b>Página web de Agente Móvil P2P</b><span>→</span></a>
    <a class="it" href="../terminos.html"><b>Términos y condiciones</b><span>→</span></a>
    <a class="it" href="../privacidad.html"><b>Política de privacidad</b><span>→</span></a>
    <a class="it" href="../libro-reclamaciones.html"><b>Libro de reclamaciones</b><span>→</span></a>
  </div></div>
  <button class="btn o" data-act="logout">Cerrar sesión</button>`;
}
function vNotes() {
  return `${back(S.prevTab || 'home')}<h1>Avisos</h1>${S.notes.length ? `<div class="card"><div class="list">${S.notes.map(n => `<button class="it" data-act="note" data-id="${n.order_id || ''}"><b>${esc(n.title)}</b><span class="mut">${when(n.created_at)}</span><span class="mut" style="grid-column:1/-1">${esc(n.body || '')}</span></button>`).join('')}</div></div>` : '<p class="empty">No tienes avisos.</p>'}
  ${'Notification' in window && Notification.permission === 'default' ? `<button class="btn o" data-act="perm">Activar avisos en este dispositivo</button>` : ''}`;
}

/* ======================= PANEL DE SOPORTE ======================= */
function person(id) { const p = S.st.profs?.[id]; return p ? `${esc(p.full_name)} <span class="mut">DNI ${esc(p.dni || '—')}</span>` : '—'; }
function vStaff() {
  const s = S.st, sum = s.sum || {};
  const tabs = [['recargas', `Recargas (${s.tops?.length || 0})`], ...(s.deps?.length ? [['depositos', `Depósitos antiguos (${s.deps.length})`]] : []), ['casos', `Casos (${(s.cases || []).filter(c => c.status === 'abierto').length})`], ['retiros', `Retiros (${s.wds?.length || 0})`],
    ['identidad', `Verificaciones (${s.kyc?.length || 0})`], ['agentes', 'Agentes'], ['operaciones', 'Operaciones'], ['entidades', 'Entidades'], ['lista', 'Lista negra'], ['reclamos', `Reclamos (${(s.recl || []).filter(r => r.status === 'recibido').length})`], ...(S.me.role === 'admin' ? [['ajustes', 'Ajustes']] : [])];
  let body = '';
  const t = S.staffTab;
  if (t === 'recargas') body = `<p class="mut">Busca cada abono en la cuenta ${esc(S.cfg.company_bank)} de la empresa: mismo monto, mismo código y que el ordenante sea el titular de la cuenta. Al confirmar, el monto aparece en su saldo virtual.</p>` + (s.tops.length ? s.tops.map(t => `<div class="card"><div class="row"><h3 class="num">${money(t.amount)}</h3><span class="mut">${when(t.created_at)}</span></div>
    <p style="margin:6px 0">${person(t.user_id)}<br>Código de operación: <b>${esc(t.op_code)}</b></p>
    ${proofImg('recargas', t.proof_path, 'Constancia de la recarga')}
    <label class="f" for="tn-${t.id}">Motivo si rechazas</label><input id="tn-${t.id}" placeholder="Ej. El ordenante es otra persona">
    <div class="grid2"><button class="btn" data-act="stop" data-id="${t.id}" data-ok="1">Llegó: acreditar ${money(t.amount)}</button><button class="btn r" data-act="stop" data-id="${t.id}" data-ok="0">Rechazar</button></div></div>`).join('') : '<p class="empty">No hay recargas por validar.</p>');
  if (t === 'depositos') body = s.deps.length ? s.deps.map(o => `<div class="card"><div class="row"><h3>${esc(o.code)}</h3><b class="num">${money(o.total)}</b></div>
    <p class="mut" style="margin:4px 0">Cliente: ${person(o.client_id)}<br>Código informado: <b>${esc(o.deposit_code)}</b> · ${when(o.created_at)}</p>
    <p style="margin:6px 0">Busca en la cuenta ${esc(S.cfg.company_bank)} de la empresa un abono de <b>${money(o.total)}</b> con ese código, y que el ordenante sea <b>${esc(o.dest_holder)}</b>.</p>
    ${proofImg('comprobantes', o.deposit_proof, 'Constancia del cliente')}
    <div class="grid2"><button class="btn" data-act="sdep" data-id="${o.id}" data-ok="1">Llegó y el titular coincide: publicar</button><button class="btn r" data-act="sdep" data-id="${o.id}" data-ok="0">Rechazar</button></div></div>`).join('') : '<p class="empty">No hay depósitos por validar.</p>';
  if (t === 'casos') body = (s.cases || []).length ? s.cases.map(k => { const o = s.caseOrders.find(x => x.id === k.order_id); if (!o) return '';
    return `<div class="card"><div class="row"><h3>Caso ${k.id} · ${esc(o.code)}</h3><span class="tag ${k.status === 'abierto' ? (k.type === 'denuncia' ? 't-bad' : 't-warn') : 't-ok'}">${k.status === 'abierto' ? (k.type === 'denuncia' ? 'Denuncia de voucher falso' : 'Cliente no respondió') : 'Resuelto'}</span></div>
    <div class="grid2" style="margin-top:8px"><div><p class="mut" style="margin:0">Cliente</p>${person(o.client_id)}<br><span class="mut">Destino: ${esc(o.dest_entity)} ${esc(o.dest_number)}</span></div>
    <div><p class="mut" style="margin:0">Agente</p>${person(o.agent_id)}<br><span class="mut">Código: <b>${esc(o.voucher_code)}</b> · ${money(o.amount)}</span></div></div>
    ${proofImg('comprobantes', o.voucher_path, 'Voucher del agente')}
    ${k.status === 'abierto' ? `<p style="margin:10px 0 0"><b>Antes de decidir:</b> consulta el código ${esc(o.voucher_code)} con ${esc(o.dest_entity)} (banca del agente, llamada a la entidad o al cliente).</p>
    <label class="f" for="cn-${k.id}">Nota de verificación</label><input id="cn-${k.id}" placeholder="Ej. Caja Trujillo confirmó la operación por teléfono">
    <div class="grid2"><button class="btn" data-act="scase" data-id="${k.id}" data-ok="1">La transferencia existe: liberar al agente${k.type === 'denuncia' ? ' y bloquear al cliente' : ''}</button>
    <button class="btn r" data-act="scase" data-id="${k.id}" data-ok="0">No existe: devolver al cliente y bloquear al agente</button></div>`
    : `<div class="alert a-ok">${esc(k.resolution || (k.transfer_ok ? 'Transferencia confirmada' : 'Voucher falso'))}</div>`}</div>`; }).join('') : '<p class="empty">Sin casos.</p>';
  if (t === 'retiros') body = `<p class="mut">Transfiere a la cuenta indicada y registra el código. Al marcarlo como pagado, el monto se descuenta automáticamente del saldo de la persona.</p>` + (s.wds.length ? s.wds.map(w => `<div class="card"><div class="row"><h3>${money(w.amount)}</h3><span class="mut">${when(w.created_at)}</span></div>
    <p style="margin:6px 0">${person(w.user_id)}<br>A: <b>${esc(w.entity)} ${esc(w.number)}</b></p>
    <label class="f" for="wc-${w.id}">Código de operación del pago</label><input id="wc-${w.id}" inputmode="numeric">
    <div class="grid2"><button class="btn" data-act="swd" data-id="${w.id}" data-ok="1">Marcar como pagado</button><button class="btn o" data-act="swd" data-id="${w.id}" data-ok="0">Rechazar</button></div></div>`).join('') : '<p class="empty">No hay retiros por pagar.</p>');
  if (t === 'identidad') { const withP = s.kyc.filter(p => p.kyc_status === 'en_revision'), noP = s.kyc.filter(p => p.kyc_status === 'pendiente');
    const card = p => `<div class="card"><div class="row"><h3>${esc(p.full_name || 'Sin nombre')}</h3><span class="mut">DNI ${esc(p.dni || '—')}</span></div>
    <p class="mut" style="margin:4px 0">${esc(p.email)} · ${esc(p.phone || '')} · ${esc(p.dept || '')} · registrado ${when(p.created_at)}<br>${p.agent_status === 'solicitado' ? '<span class="tag t-info">Quiere ser agente</span>' : '<span class="tag t-mute">Cliente</span>'}</p>
    ${p.kyc_status === 'en_revision' ? `<div class="ph"><img data-b="kyc" data-p="${esc(p.dni_photo_path)}" alt="DNI"><img data-b="kyc" data-p="${esc(p.selfie_path)}" alt="Selfie"></div>
    <p style="margin:8px 0">Comprueba que el nombre y el DNI coinciden con la foto, que la selfie es la misma persona y que no se parece a nadie de la lista negra.</p>`
    : `<div class="alert a-warn" style="margin-top:8px">Aún no subió su DNI ni su selfie. Confírmalo solo si verificaste su identidad por otro medio (en persona o por videollamada con su DNI).</div>`}
    <label class="f" for="kn-${p.id}">Nota (obligatoria si rechazas)</label><input id="kn-${p.id}" placeholder="${p.kyc_status === 'pendiente' ? 'Ej. Verificado por videollamada con DNI' : 'Ej. La selfie no coincide'}">
    <div class="grid2"><button class="btn" data-act="skyc" data-id="${p.id}" data-ok="1">Confirmar verificación${p.agent_status === 'solicitado' ? ' y activar agente' : ''}</button><button class="btn r" data-act="skyc" data-id="${p.id}" data-ok="0">Rechazar</button></div></div>`;
    body = (s.kyc.length ? `${withP.length ? `<h2 class="sec">Enviaron sus fotos (${withP.length})</h2>${withP.map(card).join('')}` : ''}${noP.length ? `<h2 class="sec">Registrados sin fotos (${noP.length})</h2>${noP.map(card).join('')}` : ''}` : '<p class="empty">Nadie está esperando verificación.</p>')
    + (s.flagged.length ? `<h2 class="sec">Cuentas observadas</h2><div class="card">${s.flagged.map(a => `<p>${person(a.user_id)}<br>${esc(a.entity)} ${esc(a.number)} · <span class="tag t-bad">${esc(a.flagged)}</span></p>`).join('')}</div>` : ''); }
  if (t === 'agentes') body = `<div class="scroll"><table><thead><tr><th>Agente</th><th>Estado</th><th>Strikes</th><th class="n">Saldo</th><th class="n">Garantía</th><th></th></tr></thead><tbody>${s.agents.map(p => {
    const susp = p.suspended_until && new Date(p.suspended_until).getTime() > now();
    return `<tr><td>${esc(p.full_name)}<br><span class="mut">${esc(p.dept || '')} · DNI ${esc(p.dni || '')}</span></td><td>${p.banned ? '<span class="tag t-bad">Bloqueado</span>' : p.agent_status === 'solicitado' ? '<span class="tag t-warn">Solicitó</span>' : p.agent_status === 'retirado' ? '<span class="tag t-mute">Sin rol</span>' : susp ? '<span class="tag t-warn">Suspendido</span>' : '<span class="tag t-ok">Activo</span>'}</td>
    <td>${p.strikes}</td><td class="n">${money(p.wallet)}</td><td class="n">${money(p.guarantee)}</td><td>${p.agent_status === 'solicitado' ? `<button class="btn sm" data-act="sagent" data-id="${p.id}" data-ok="1">Activar</button> <button class="btn o sm" data-act="sagent" data-id="${p.id}" data-ok="0">Rechazar</button>` : susp && !p.banned ? `<button class="btn o sm" data-act="sunsusp" data-id="${p.id}">Quitar suspensión</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  if (t === 'operaciones') body = `<div class="scroll"><table><thead><tr><th>Orden</th><th>Destino</th><th class="n">Monto</th><th class="n">Comisión</th><th>Estado</th><th>Creada</th></tr></thead><tbody>${s.recent.map(o => `<tr><td>${esc(o.code)}<br><span class="mut">${esc(o.client_short)}</span></td><td>${esc(o.dest_entity)}</td><td class="n">${money(o.amount)}</td><td class="n">${pctS(o.pct)}</td><td><span class="tag ${ST[o.status][1]}">${ST[o.status][0]}</span></td><td>${when(o.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
  if (t === 'entidades') body = `<p class="mut">Si una entidad tiene caída de servicio, márcala: los relojes de sus operaciones se pausan y al volver se devuelve el tiempo perdido.</p><div class="card">${S.ents.map(e => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span>${esc(e.name)} ${e.down ? `<span class="tag t-bad">Caída desde ${hm(e.down_since)}</span>` : ''}</span><button class="btn ${e.down ? '' : 'o'} sm" data-act="sdown" data-v="${esc(e.name)}" data-ok="${e.down ? 0 : 1}">${e.down ? 'Ya funciona' : 'Marcar caída'}</button></div>`).join('')}</div>`;
  if (t === 'lista') body = (s.bannedBal.length ? `<h2 class="sec">Bloqueados con dinero por devolver</h2>${s.bannedBal.map(p => `<div class="card"><div class="row"><b>${esc(p.full_name)}</b><b class="num">${money(+p.wallet + +p.guarantee)}</b></div>
    <p class="mut" style="margin:4px 0">DNI ${esc(p.dni || '—')} · ${esc(p.phone || '')} · saldo ${money(p.wallet)} · garantía ${money(p.guarantee)}<br>${esc(p.ban_reason || '')}</p>
    <label class="f" for="bc-${p.id}">Código de operación de la devolución</label><input id="bc-${p.id}" inputmode="numeric">
    <button class="btn o" data-act="ssettle" data-id="${p.id}">Ya le transferí: registrar devolución</button></div>`).join('')}<h2 class="sec">Lista negra</h2>` : '') + (s.black.length ? `<div class="card">${s.black.map(b => `<div class="row" style="padding:8px 0;border-top:1px solid var(--line)"><span><b>${esc(b.full_name || '—')}</b><br><span class="mut">DNI ${esc(b.dni)} · ${esc(b.reason)}</span></span><span class="mut">${when(b.created_at)}</span></div>`).join('')}</div>` : '<p class="empty">La lista negra está vacía.</p>');
  if (t === 'reclamos') body = `<p class="mut">La ley da 15 días hábiles para responder. Responde por correo al cliente y registra aquí tu respuesta.</p>` + ((s.recl || []).length ? s.recl.map(r => { const days = Math.floor((now() - new Date(r.created_at)) / 864e5);
    return `<div class="card"><div class="row"><h3>${esc(r.code)} · ${r.kind === 'reclamo' ? 'Reclamo' : 'Queja'}</h3><span class="tag ${r.status === 'respondido' ? 't-ok' : days > 10 ? 't-bad' : 't-warn'}">${r.status === 'respondido' ? 'Respondido' : 'Hace ' + days + ' días'}</span></div>
    <p class="mut" style="margin:6px 0">${esc(r.full_name)} · doc. ${esc(r.doc)} · ${esc(r.email)} · ${esc(r.phone || '')}<br>${esc(r.address || '')}</p>
    <p style="margin:6px 0"><b>Servicio:</b> ${esc(r.service)}${r.amount ? ' · <b>Monto:</b> ' + money(r.amount) : ''}</p>
    <p style="margin:6px 0"><b>Detalle:</b> ${esc(r.detail)}</p><p style="margin:6px 0"><b>Pedido:</b> ${esc(r.request)}</p>
    ${r.status === 'respondido' ? `<div class="alert a-ok"><b>Respuesta (${when(r.answered_at)}):</b> ${esc(r.answer)}</div>` : `<label class="f" for="ra-${r.id}">Respuesta enviada al cliente</label><textarea id="ra-${r.id}"></textarea><button class="btn sm" style="margin-top:8px" data-act="srecl" data-id="${r.id}">Registrar respuesta</button>`}</div>`; }).join('') : '<p class="empty">No hay reclamos.</p>');
  if (t === 'ajustes') { const c = S.cfg; const F = [['company_bank','Banco de la cuenta recaudadora','text'],['company_account','Número de cuenta recaudadora','text'],['company_cci','CCI (opcional)','text'],['company_holder','Titular de la cuenta','text'],['min_amount','Monto mínimo (S/)','number'],['max_amount','Monto máximo por operación (S/)','number'],['default_pct','Comisión base (%)','number'],['max_pct','Comisión máxima (%)','number'],['agent_share','Parte del agente (0.75 = 75%)','number'],['agent_minutes','Minutos del agente','number'],['client_minutes','Minutos del cliente','number'],['strikes_max','Strikes para perder el rol','number'],['suspend_hours','Horas de suspensión por strike','number']];
    body = `<div class="card">${F.map(([k, l, ty]) => `<label class="f" for="cfg-${k}">${l}</label><input id="cfg-${k}" type="${ty}" step="any" value="${esc(c[k] ?? '')}">`).join('')}<p class="err" id="cfg-err"></p><button class="btn" data-act="scfg">Guardar ajustes</button></div>
    <div class="card"><h3>Dar rol de soporte</h3><label class="f" for="role-email">Correo del usuario</label><input id="role-email" type="email"><label class="f" for="role-v">Rol</label><select id="role-v"><option value="soporte">Soporte</option><option value="usuario">Usuario normal</option><option value="admin">Administrador</option></select><p class="err" id="role-err"></p><button class="btn o" data-act="srole">Guardar rol</button></div>`; }
  return `<div class="row"><h1>Soporte</h1><button class="btn o sm" data-act="refresh">Actualizar</button></div>
  <div class="kpis"><button class="kpi go${s.kyc?.length ? ' hot2' : ''}" data-act="stab" data-v="identidad"><span class="mut">Esperando verificación</span><b>${s.kyc?.length || 0} ${s.kyc?.length === 1 ? 'persona' : 'personas'}</b></button><button class="kpi go${s.tops?.length ? ' hot2' : ''}" data-act="stab" data-v="recargas"><span class="mut">Recargas por validar</span><b>${s.tops?.length || 0}</b></button><div class="kpi"><span class="mut">En custodia</span><b>${money(sum.custody)}</b></div><div class="kpi"><span class="mut">Saldos de usuarios</span><b>${money(sum.wallets)}</b></div><div class="kpi"><span class="mut">Garantías de agentes</span><b>${money(sum.guarantees)}</b></div><button class="kpi go${s.wds?.length ? ' hot2' : ''}" data-act="stab" data-v="retiros"><span class="mut">Retiros por pagar</span><b>${money(sum.withdrawals_pending)}</b></button><div class="kpi"><span class="mut">Ganancia de la plataforma</span><b>${money(sum.platform_earned)}</b></div></div>
  <p class="mut">En la cuenta de la empresa debe haber al menos: custodia + saldos + garantías${+sum.withdrawals_held ? ' + retiros antiguos ya descontados' : ''} = <b class="num">${money(+sum.custody + +sum.wallets + +sum.guarantees + +sum.withdrawals_held)}</b>, más la ganancia acumulada (${money(sum.platform_earned)}).</p>
  <div class="stabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${t === k}" data-act="stab" data-v="${k}">${l}</button>`).join('')}</div>
  <div style="margin-top:6px">${body}</div>`;
}

/* ======================= RENDER ======================= */
function sheet() {
  const s = S.sheet; if (!s) return '';
  if (s.type === 'fake') { const o = ord(s.id); return `<div class="ov" role="dialog" aria-modal="true" aria-labelledby="sh-h"><div class="sheet">
    <h2 id="sh-h" style="color:var(--r);display:flex;gap:8px;align-items:center">${ic('warn')} Advertencia de seguridad</h2>
    <p>Dices que el voucher del agente es <b>falso</b>. Vamos a auditar el código <b>${esc(o.voucher_code)}</b> directamente con ${esc(o.dest_entity)}.</p>
    <ul><li>Si es falso: te devolvemos el dinero, el agente queda bloqueado de por vida y lo denunciamos.</li><li><b>Si el dinero sí llegó a tu cuenta:</b> tu cuenta queda bloqueada para siempre con tu DNI y tu rostro.</li></ul>
    <p><b>¿Estás 100% seguro de que no recibiste ${money(o.amount)}?</b></p>
    <button class="btn r" data-act="fakeyes" data-id="${o.id}">Sí, estoy seguro. Iniciar auditoría</button>
    <button class="btn o" data-act="close">No, déjame revisar mi banca móvil</button></div></div>`; }
  if (s.type === 'confirm') return `<div class="ov" role="dialog" aria-modal="true" aria-labelledby="sh-h"><div class="sheet"><h2 id="sh-h">${esc(s.title)}</h2><p>${esc(s.text)}</p>
    ${s.input ? `<label class="f" for="sh-in">${esc(s.input)}</label><input id="sh-in">` : ''}<p class="err" id="sh-err"></p>
    <button class="btn ${s.danger ? 'r' : ''}" data-act="confirmyes">${esc(s.yes)}</button><button class="btn o" data-act="close">Volver</button></div></div>`;
  return '';
}
function render() {
  const app = $('#app');
  const y = window.scrollY;
  const f = document.activeElement?.id;
  document.body.classList.toggle('wide', !!(S.user && S.tab === 'staff'));
  if (!S.user || S.auth === 'newpass') { app.innerHTML = vAuth(); return; }
  if (!S.me) { app.innerHTML = '<div class="spin">Preparando tu cuenta…</div>'; return; }
  const unread = S.notes.filter(n => !n.read).length;
  const top = `<header class="top"><div class="in">${brand()}<button class="ib" data-act="notes" aria-label="Avisos${unread ? ', ' + unread + ' sin leer' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${IC.bell}</svg>${unread ? `<span class="dot">${unread}</span>` : ''}</button></div></header>`;
  if (S.me.banned) { app.innerHTML = top + vBlocked(); return; }
  let body;
  const v = S.view;
  if (v?.k === 'kyc') body = vKyc();
  else if (v?.k === 'topup') body = vTopup();
  else if (v?.k === 'new') body = vNew();
  else if (v?.k === 'order') body = vOrder(ord(v.id));
  else if (v?.k === 'aorder') body = vAgentOrder(ord(v.id));
  else if (v?.k === 'notes') body = vNotes();
  else body = { home: vHome, agent: vAgent, wallet: vWallet, account: vAccount, staff: vStaff }[S.tab]();
  const tabs = [['home','Inicio','home'], ['agent','Órdenes','list'], ['wallet','Billetera','wal'], ['account','Cuenta','user'], ...(isStaff() ? [['staff','Soporte','shield']] : [])];
  app.innerHTML = top + `<main class="wrap">${body}</main><nav class="nav" aria-label="Menú"><div class="in">${tabs.map(([k, l, i]) => `<button data-act="tab" data-v="${k}" aria-current="${S.tab === k && !v}">${ic(i)}${l}</button>`).join('')}</div></nav>` + sheet();
  if (v?.k === 'new') updSum();
  window.scrollTo(0, y);
  if (f && $('#' + f)) $('#' + f).focus();
  updClocks(); fillImgs(); fillEvents();
}

/* ======================= ACCIONES ======================= */
const A = {
  auth: d => { S.auth = d.v; render(); },
  regrole: d => { S.regRole = d.v; render(); },
  eye: (d, b) => { const i = $('#' + d.for); if (!i) return; const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña'); b.innerHTML = ic(show ? 'eyeoff' : 'eye'); },
  topup: () => { if (!verified()) { S.view = { k: 'kyc' }; render(); toast('Primero verificamos tu identidad para que puedas recargar.'); return; } S.view = { k: 'topup' }; render(); window.scrollTo(0, 0); },
  async sendtopup(d, b) { await run(b, async () => {
    const amt = +val('t-amt'), code = val('t-code'), f = $('#t-file').files[0];
    if (!(amt >= 10)) throw new Error('La recarga mínima es S/ 10.00.');
    if (!/^\d{6,12}$/.test(code)) throw new Error('Escribe el código de operación (6 a 12 dígitos).');
    const path = await api.upload('recargas', `${meId()}/${Date.now()}.jpg`, await compress(f));
    await api.rpc('request_topup', { p_amount: amt, p_code: code, p_proof: path });
    await refresh(); toast('Recibido. Cuando validemos que llegó, verás el monto en tu saldo.'); }, 't-err'); },
  async gadd(d, b) { await run(b, async () => { const v = +val('g-amt'); if (!(v > 0)) throw new Error('Escribe el monto.'); await api.rpc('add_guarantee', { p_amount: v }); await refresh(); toast('Garantía actualizada.'); }, 'g-err'); },
  async grel(d, b) { await run(b, async () => { const v = +val('g-amt'); if (!(v > 0)) throw new Error('Escribe el monto.'); await api.rpc('release_guarantee', { p_amount: v }); await refresh(); toast('Garantía liberada a tu saldo.'); }, 'g-err'); },
  stop: async (d, b) => run(b, async () => { const ok = d.ok === '1', note = val('tn-' + d.id); if (!ok && !note) throw new Error('Escribe el motivo del rechazo.'); await api.rpc('review_topup', { p_id: +d.id, p_ok: ok, p_note: note || null }); await refresh(); toast(ok ? 'Recarga acreditada al saldo.' : 'Recarga rechazada.'); }),
  ssettle: async (d, b) => run(b, async () => { const code = val('bc-' + d.id); if (!code) throw new Error('Escribe el código de operación de la devolución.'); await api.rpc('staff_settle_banned', { p_user: d.id, p_code: code }); await refresh(); toast('Devolución registrada.'); }),
  kycview: () => { S.view = { k: 'kyc' }; render(); window.scrollTo(0, 0); },
  async login(d, b) { await run(b, async () => { const e = val('l-email'), p = $('#l-pass').value; if (!e || !p) throw new Error('Escribe tu correo y contraseña.'); await api.signIn(e, p); await start(); }, 'l-err'); },
  async register(d, b) { await run(b, async () => {
    const v = { rol: S.regRole, full_name: upper(val('r-name')).trim(), dni: val('r-dni'), phone: val('r-phone'), dept: val('r-dept'), email: val('r-email'), password: $('#r-pass').value };
    if (v.full_name.split(/\s+/).length < 2) throw new Error('Escribe tus nombres y apellidos.');
    if (!/^\d{8}$/.test(v.dni)) throw new Error('El DNI tiene 8 dígitos.');
    if (!/^9\d{8}$/.test(v.phone)) throw new Error('El celular tiene 9 dígitos y empieza con 9.');
    if (!v.dept) throw new Error('Elige tu departamento.');
    if (v.password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (!$('#r-tc').checked) throw new Error('Debes aceptar los términos para continuar.');
    const logged = await api.signUp(v);
    if (!logged) { S.auth = 'login'; render(); toast('Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego ingresa.'); return; }
    await start(); }, 'r-err'); },
  async forgot(d, b) { await run(b, async () => { await api.reset(val('f-email')); S.auth = 'login'; render(); toast('Revisa tu correo: te enviamos el enlace.'); }, 'f-err'); },
  async newpass(d, b) { await run(b, async () => { const p = $('#n-pass').value; if (p.length < 8) throw new Error('Mínimo 8 caracteres.'); await api.newPassword(p); S.auth = 'login'; toast('Contraseña actualizada.'); await start(); }, 'n-err'); },
  async logout() { await api.signOut(); location.reload(); },
  async refresh(d, b) { await run(b, async () => { await api.rpc('tick').catch(() => {}); await refresh(); }); },
  async kyc(d, b) { await run(b, async () => {
    const name = upper(val('k-name')).trim(), dni = val('k-dni'), f1 = $('#k-doc').files[0], f2 = $('#k-self').files[0];
    if (!/^\d{8}$/.test(dni)) throw new Error('El DNI tiene 8 dígitos.');
    if (!f1 || !f2) throw new Error('Sube las dos fotos.');
    const id = meId(), t = Date.now();
    const p1 = await api.upload('kyc', `${id}/dni-${t}.jpg`, await compress(f1));
    const p2 = await api.upload('kyc', `${id}/selfie-${t}.jpg`, await compress(f2));
    const r = await api.rpc('submit_kyc', { p_full_name: name, p_dni: dni, p_dni_photo: p1, p_selfie: p2 });
    S.view = null; await refresh(); if (r === 'en_revision') toast('Recibimos tus fotos. Te avisaremos cuando estén revisadas.'); }, 'k-err'); },
  tab: d => { S.tab = d.v; S.view = null; render(); window.scrollTo(0, 0); },
  go: d => { S.tab = d.tab; S.view = d.view ? { k: d.view } : null; render(); },
  notes: () => { S.prevTab = S.tab; S.view = { k: 'notes' }; render(); window.scrollTo(0, 0); if (S.notes.some(n => !n.read)) api.markRead(meId()).then(() => { S.notes.forEach(n => n.read = true); }); },
  note: d => { if (!d.id) return; const o = ord(d.id); if (!o) return; if (o.client_id === meId()) { S.tab = 'home'; S.view = { k: 'order', id: o.id }; } else if (o.agent_id === meId()) { S.tab = 'agent'; S.view = { k: 'aorder', id: o.id }; } else if (isStaff()) { S.tab = 'staff'; S.view = null; } render(); },
  new: () => { if (!verified()) { S.view = { k: 'kyc' }; render(); toast('Primero verificamos tu identidad para que puedas operar.'); return; } const c = S.cfg; S.draft = S.draft || { funding: 'saldo', acc: null, amount: 1000, pct: +c.default_pct }; S.view = { k: 'new' }; render(); window.scrollTo(0, 0); },
  async create(d, b) { await run(b, async () => {
    const x = S.draft; const id = await api.rpc('create_order', { p_dest_account: +x.acc, p_amount: +x.amount, p_pct: +x.pct, p_funding: 'saldo' });
    await refresh(); S.view = { k: 'order', id }; render(); window.scrollTo(0, 0); }, 'd-err'); },
  open: d => { S.tab = 'home'; S.view = { k: 'order', id: +d.id }; render(); window.scrollTo(0, 0); },
  aopen: d => { S.tab = 'agent'; S.view = { k: 'aorder', id: +d.id }; render(); window.scrollTo(0, 0); },
  async copy(d) { try { await navigator.clipboard.writeText(d.v); toast('Copiado.'); } catch { toast('Copia manualmente: ' + d.v); } },
  async deposit(d, b) { await run(b, async () => {
    const code = val('dp-code'), f = $('#dp-file').files[0];
    if (!/^\d{6,12}$/.test(code)) throw new Error('Escribe el código de operación (6 a 12 dígitos).');
    const path = await api.upload('comprobantes', `${d.id}/${meId()}-${Date.now()}.jpg`, await compress(f));
    await api.rpc('submit_deposit', { p_order: +d.id, p_code: code, p_proof: path }); await refresh(); toast('Recibido. Validamos tu depósito y publicamos tu orden.'); }, 'dp-err'); },
  cancel: d => { S.sheet = { type: 'confirm', title: '¿Cancelar la orden?', text: 'Si ya está publicada, el dinero vuelve a tu saldo virtual.', yes: 'Sí, cancelar', fn: () => api.rpc('cancel_order', { p_order: +d.id }) }; render(); },
  ok: async (d, b) => run(b, async () => { await api.rpc('client_confirm', { p_order: +d.id }); await refresh(); toast('¡Listo! Operación completada.'); }),
  notyet: async (d, b) => run(b, async () => { await api.rpc('client_not_yet', { p_order: +d.id }); await refresh(); toast('Avisamos al agente. Revisa de nuevo en unos minutos.'); }),
  fake: d => { S.sheet = { type: 'fake', id: +d.id }; render(); },
  fakeyes: async (d, b) => run(b, async () => { await api.rpc('client_report_fake', { p_order: +d.id }); S.sheet = null; await refresh(); toast('Auditoría iniciada. Tu dinero queda congelado mientras soporte verifica.'); }),
  close: () => { S.sheet = null; render(); },
  async confirmyes(d, b) { const s = S.sheet; await run(b, async () => { await s.fn(val('sh-in')); S.sheet = null; await refresh(); if (s.done) toast(s.done); }, 'sh-err'); },
  async retry(d, b) { const p = ord(d.id); await run(b, async () => { const id = await api.rpc('create_order', { p_dest_account: p.dest_account_id, p_amount: +p.amount, p_pct: +p.pct, p_funding: 'saldo' }); await refresh(); S.view = { k: 'order', id }; render(); toast('Orden publicada otra vez con tu saldo.'); }); },
  agf: d => { S.agF = d.v; S.agSub = null; render(); },
  agsub: d => { S.agSub = S.agSub === d.v ? null : d.v; render(); },
  async beagent(d, b) { await run(b, async () => { await api.rpc('request_agent'); await refresh(); toast('Solicitud enviada.'); }); },
  async take(d, b) { await run(b, async () => { await api.rpc('accept_order', { p_order: +d.id }); await refresh(); S.view = { k: 'aorder', id: +d.id }; render(); window.scrollTo(0, 0); }); },
  async voucher(d, b) { await run(b, async () => {
    const code = val('v-code'), f = $('#v-file').files[0];
    if (!/^\d{6,12}$/.test(code)) throw new Error('Escribe el código de operación (6 a 12 dígitos).');
    const path = await api.upload('comprobantes', `${d.id}/${meId()}-${Date.now()}.jpg`, await compress(f));
    await api.rpc('submit_voucher', { p_order: +d.id, p_code: code, p_path: path }); await refresh(); toast('Enviado. Esperamos la confirmación del cliente.'); }, 'v-err'); },
  giveup: d => { S.sheet = { type: 'confirm', title: '¿No puedes hacer la transferencia?', text: `El dinero vuelve al cliente y sumas un strike. Con ${S.cfg.strikes_max} pierdes el rol de agente.`, yes: 'Sí, liberar la orden', danger: true, fn: () => api.rpc('agent_give_up', { p_order: +d.id }) }; render(); },
  mismatch: d => { S.sheet = { type: 'confirm', title: 'El titular no coincide', text: 'No transfieras. La orden se cancela sin strike para ti y la cuenta queda observada.', input: '¿Qué nombre muestra tu banca?', yes: 'Reportar y cancelar', danger: true, fn: v => { if (!v) throw new Error('Escribe el nombre que aparece.'); return api.rpc('report_holder_mismatch', { p_order: +d.id, p_seen: v }); }, done: 'Reportado. Gracias por cuidar la plataforma.' }; render(); },
  async withdraw(d, b) { await run(b, async () => { await api.rpc('request_withdrawal', { p_account: +val('w-acc'), p_amount: +val('w-amt') }); await refresh(); toast('Retiro solicitado. Se descontará de tu saldo cuando soporte confirme el pago.'); }, 'w-err'); },
  async addacc(d, b) { await run(b, async () => { await api.rpc('add_account', { p_entity: val('a-ent'), p_number: val('a-num') }); await refresh(); toast('Cuenta agregada.'); }, 'a-err'); },
  rmacc: d => { S.sheet = { type: 'confirm', title: '¿Quitar esta cuenta?', text: 'Podrás agregarla de nuevo cuando quieras.', yes: 'Quitar', fn: () => api.rpc('remove_account', { p_id: +d.id }) }; render(); },
  perm: () => { try { Notification.requestPermission().then(render); } catch {} },
  stab: d => { S.staffTab = d.v; render(); },
  sdep: d => { const ok = d.ok === '1'; S.sheet = { type: 'confirm', title: ok ? 'Publicar la orden' : 'Rechazar el depósito', text: ok ? 'Confirmas que el dinero está en la cuenta de la empresa y que el ordenante es el cliente.' : 'El cliente verá el motivo. Si el dinero llegó, devuélvelo a la cuenta de origen.', input: ok ? null : 'Motivo', yes: ok ? 'Sí, publicar' : 'Rechazar', danger: !ok, fn: v => api.rpc('review_deposit', { p_order: +d.id, p_ok: ok, p_note: v || null }) }; render(); },
  async scase(d, b) { const ok = d.ok === '1', note = val('cn-' + d.id); if (!note) { toast('Escribe cómo verificaste el código.'); return; }
    S.sheet = { type: 'confirm', title: ok ? 'Liberar al agente' : 'Devolver al cliente', text: ok ? 'La transferencia existe. El agente recibe su dinero' + ' y, si fue una denuncia, el cliente queda bloqueado.' : 'El voucher es falso. El cliente recupera su dinero y el agente queda bloqueado y en la lista negra.', yes: 'Confirmar decisión', danger: !ok, fn: () => api.rpc('resolve_case', { p_case: +d.id, p_transfer_ok: ok, p_note: note }) }; render(); },
  async swd(d, b) { const ok = d.ok === '1', code = val('wc-' + d.id); if (ok && !code) { toast('Escribe el código de operación del pago.'); return; } await run(b, async () => { await api.rpc('resolve_withdrawal', { p_id: +d.id, p_paid: ok, p_code: code || 'Rechazado por soporte' }); await refresh(); }); },
  skyc: async (d, b) => run(b, async () => { const ok = d.ok === '1', note = val('kn-' + d.id); if (!ok && !note) throw new Error('Escribe el motivo del rechazo.'); await api.rpc('review_kyc', { p_user: d.id, p_ok: ok, p_note: note || null }); await refresh(); toast(ok ? 'Verificación confirmada.' : 'Verificación rechazada.'); }),
  sagent: async (d, b) => run(b, async () => { await api.rpc('review_agent', { p_user: d.id, p_ok: d.ok === '1' }); await refresh(); }),
  sunsusp: async (d, b) => run(b, async () => { await api.rpc('staff_lift_suspension', { p_user: d.id }); await refresh(); }),
  sdown: async (d, b) => run(b, async () => { await api.rpc('set_entity_down', { p_entity: d.v, p_down: d.ok === '1' }); await refresh(); }),
  async scfg(d, b) { await run(b, async () => { const v = {}; for (const k of ['company_bank','company_account','company_cci','company_holder']) v[k] = val('cfg-' + k) || null;
    for (const k of ['min_amount','max_amount','default_pct','max_pct','agent_share','agent_minutes','client_minutes','strikes_max','suspend_hours']) v[k] = +val('cfg-' + k);
    v.updated_at = new Date().toISOString(); await api.updateSettings(v); await refresh(); toast('Ajustes guardados.'); }, 'cfg-err'); },
  srecl: async (d, b) => run(b, async () => { const a = val('ra-' + d.id); if (a.length < 10) throw new Error('Escribe la respuesta que enviaste.'); await api.rpc('answer_complaint', { p_id: +d.id, p_answer: a }); await refresh(); toast('Respuesta registrada.'); }),
  async srole(d, b) { await run(b, async () => { await api.rpc('admin_set_role', { p_email: val('role-email'), p_role: val('role-v') }); toast('Rol actualizado.'); }, 'role-err'); }
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const f = A[b.dataset.act]; if (!f) return;
  e.preventDefault(); f(b.dataset, b);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'r-name' || t.id === 'k-name') { const p = t.selectionStart; t.value = t.value.toUpperCase(); try { t.setSelectionRange(p, p); } catch {} }
  const d = S.draft; if (!d) return;
  if (t.id === 'd-amt') { d.amount = t.value; updSum(); }
  if (t.id === 'd-pct') { d.pct = +t.value; updSum(); }
});
document.addEventListener('change', e => {
  const t = e.target, d = S.draft; if (!d) return;
  if (t.id === 'd-acc') d.acc = +t.value;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); } });

/* ======================= ARRANQUE ======================= */
let stopListen = null;
async function start() {
  S.user = await api.session();
  if (!S.user) { render(); return; }
  await loadAll();
  if (!S.me) { render(); setTimeout(start, 1500); return; }
  render();
  stopListen?.();
  stopListen = api.listen(S.user.id, n => {
    if (n) { toast(n.title + (n.body ? ': ' + n.body : '')); try { if (document.hidden && Notification.permission === 'granted') new Notification(n.title, { body: n.body || '', icon: 'icon-192.png' }); } catch {} }
    clearTimeout(start.t); start.t = setTimeout(() => { if (!S.sheet && !document.activeElement?.matches('input,select,textarea')) refresh(); }, 400);
  });
}
async function boot() {
  if (!window.AMP_TEST_API && (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY)) {
    $('#app').innerHTML = `<div class="wrap"><div class="card"><h1>Falta conectar Supabase</h1><p>Abre <b>app/config.js</b> y pega la Project URL y la clave pública de tu proyecto. Los pasos están en el archivo LEEME.md.</p></div></div>`;
    return;
  }
  try { await api.init(); } catch (e) { $('#app').innerHTML = `<div class="wrap"><div class="card"><h1>Sin conexión</h1><p>${esc(msg(e))}</p><button class="btn" onclick="location.reload()">Reintentar</button></div></div>`; return; }
  api.onRecovery?.(() => { S.auth = 'newpass'; render(); });
  await start().catch(e => { $('#app').innerHTML = `<div class="wrap"><div class="card"><h1>Algo salió mal</h1><p>${esc(msg(e))}</p><button class="btn" onclick="location.reload()">Reintentar</button></div></div>`; });
  setInterval(updClocks, 1000);
  setInterval(async () => { if (!S.me || document.hidden) return; try { const n = await api.rpc('tick'); if (n) await refresh(); } catch {} }, 30000);
  if ('serviceWorker' in navigator && !window.AMP_TEST_API) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
}
