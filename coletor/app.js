(function(){
"use strict";

/* ============ CONFIG / CLIENTE SUPABASE ============ */
var CFG = window.COLETOR_CONFIG || {};
var sb = null;
if(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY){
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
}

/* ============ SESSÃO ============ */
var SESSION = null;
try{ var s = localStorage.getItem('coletor_session'); if(s) SESSION = JSON.parse(s); }catch(e){}
function setSession(u){ SESSION = u; try{ localStorage.setItem('coletor_session', JSON.stringify(u)); }catch(e){} }
function clearSession(){ SESSION = null; try{ localStorage.removeItem('coletor_session'); }catch(e){} }

/* ============ UTILITÁRIOS ============ */
function esc(str){
  if(str===null||str===undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function uid(prefix){ return prefix+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function normalizeScanCode(raw){
  if(raw===null||raw===undefined) return '';
  return String(raw).replace(/[\r\n\t]/g,'').replace(/[\x00-\x1F\x7F]/g,'').trim();
}
function scanMatches(code, candidates){
  var c = normalizeScanCode(code).toLowerCase();
  if(!c) return false;
  return candidates.filter(Boolean).some(function(cand){ return String(cand).toLowerCase()===c; });
}
function findProductByCode(products, code){
  var c = normalizeScanCode(code);
  if(!c) return null;
  var lc = c.toLowerCase();
  if(lc.indexOf('prd:')===0){
    var idPart = c.slice(4);
    var byId = products.find(function(p){ return p.id===idPart; });
    if(byId) return byId;
  }
  return products.find(function(p){ return (p.sku||'').toLowerCase()===lc || p.id===c; }) || null;
}
function findLocationByCode(locations, code){
  var c = normalizeScanCode(code);
  if(!c) return null;
  var lc = c.toLowerCase();
  if(lc.indexOf('loc:')===0){
    var idPart = c.slice(4);
    var byId = locations.find(function(l){ return l.id===idPart; });
    if(byId) return byId;
  }
  return locations.find(function(l){ return (l.code||'').toLowerCase()===lc || l.id===c; }) || null;
}
function variationName(product, variationId){
  if(!variationId || !product || !product.variations) return null;
  var v = product.variations.find(function(v){ return v.id===variationId; });
  return v ? v.name : null;
}
function productLabel(product, variationId){
  if(!product) return '(produto removido)';
  var lbl = product.name;
  var vn = variationName(product, variationId);
  if(vn) lbl += ' — '+vn;
  return lbl;
}
function toast(msg, kind){
  var root = document.getElementById('toast-root');
  var el = document.createElement('div');
  el.className = 'toast'+(kind?' '+kind:'');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3400);
}
function beep(ok){
  try{
    var ctx = new (window.AudioContext||window.webkitAudioContext)();
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type='sine'; o.frequency.value = ok?880:220;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.12);
    setTimeout(function(){ ctx.close(); }, 200);
  }catch(e){}
}

/* ============ AÇÕES DE BANCO (Supabase) ============ */
var DB = {
  async login(username, password){
    var r = await sb.rpc('verify_login', { p_username: username, p_password: password });
    if(r.error) throw r.error;
    return (r.data && r.data[0]) || null;
  },
  async products(){ var r = await sb.from('produtos').select('*'); if(r.error) throw r.error; return r.data; },
  async locations(){ var r = await sb.from('localizacoes').select('*'); if(r.error) throw r.error; return r.data; },
  async pendingStorageTasks(){ var r = await sb.from('tarefas_armazenagem').select('*').eq('status','PENDENTE'); if(r.error) throw r.error; return r.data; },
  async closeStorageTasks(ids){ var r = await sb.from('tarefas_armazenagem').update({status:'CONCLUIDO', qty_pending:0}).in('id', ids); if(r.error) throw r.error; },
  async stockFor(productId, variationId, locationId){
    var q = sb.from('estoque').select('*').eq('product_id', productId).eq('location_id', locationId);
    q = variationId ? q.eq('variation_id', variationId) : q.is('variation_id', null);
    var r = await q; if(r.error) throw r.error; return (r.data && r.data[0]) || null;
  },
  async addStock(productId, variationId, locationId, delta){
    var existing = await DB.stockFor(productId, variationId, locationId);
    if(existing){
      var newQty = Number(existing.quantity)+delta;
      var r = await sb.from('estoque').update({quantity:newQty}).eq('id', existing.id);
      if(r.error) throw r.error;
    } else {
      var r2 = await sb.from('estoque').insert({ id: uid('stock'), product_id:productId, variation_id:variationId||null, location_id:locationId, quantity:delta });
      if(r2.error) throw r2.error;
    }
  },
  async stockLocationsFor(productId, variationId){
    var q = sb.from('estoque').select('*').eq('product_id', productId).gt('quantity',0);
    q = variationId ? q.eq('variation_id', variationId) : q.is('variation_id', null);
    var r = await q; if(r.error) throw r.error;
    return (r.data||[]).sort(function(a,b){ return b.quantity-a.quantity; });
  },
  async addMovement(m){ m.id = uid('mov'); m.timestamp = new Date().toISOString(); var r = await sb.from('movimentacoes_estoque').insert(m); if(r.error) throw r.error; },
  async addAudit(a){ a.id = uid('audit'); a.timestamp = new Date().toISOString(); var r = await sb.from('auditoria').insert(a); if(r.error) throw r.error; },
  async salesOrdersByStatus(statuses){
    var r = await sb.from('pedidos_venda').select('*').in('status', statuses).order('created_at', {ascending:true});
    if(r.error) throw r.error; return r.data;
  },
  async orderItems(pedidoId){ var r = await sb.from('itens_pedido_venda').select('*').eq('pedido_id', pedidoId); if(r.error) throw r.error; return r.data; },
  async updateOrder(id, fields){ var r = await sb.from('pedidos_venda').update(fields).eq('id', id); if(r.error) throw r.error; },
  async updateItem(id, fields){ var r = await sb.from('itens_pedido_venda').update(fields).eq('id', id); if(r.error) throw r.error; }
};

function currentUser(){ return SESSION; }
function auditCtx(){ return { user_id: SESSION?SESSION.id:null, user_name: SESSION?SESSION.name:'Sistema' }; }

/* ============ ROTEAMENTO SIMPLES ============ */
var app = document.getElementById('app');
function renderApp(){
  app.innerHTML = '';
  if(!sb){ renderConfigMissing(); return; }
  if(!SESSION){ renderLogin(); return; }
  renderHome();
}

function renderConfigMissing(){
  app.innerHTML =
    '<div class="center-msg">'+
      '<h3>Configuração pendente</h3>'+
      '<p>Preencha SUPABASE_URL e SUPABASE_ANON_KEY no arquivo <code>config.js</code> para ativar o coletor.</p>'+
    '</div>';
}

/* ============ TOPBAR (usado dentro das telas internas) ============ */
function topbarHtml(title, opts){
  opts = opts || {};
  return '<div class="topbar">'+
    (opts.back ? '<button class="icon-btn" id="btn-back">←</button>' : '<span style="width:36px"></span>')+
    '<div><h2>'+esc(title)+'</h2>'+(opts.sub?'<div class="who">'+esc(opts.sub)+'</div>':'')+'</div>'+
    '<span style="width:36px"></span>'+
  '</div>';
}

/* ============ LOGIN ============ */
function renderLogin(){
  app.innerHTML =
    '<div class="login-wrap"><div class="login-card">'+
      '<h1>Coletor</h1><div class="sub">Estoque Messias — Armazenagem · Separação · Conferência</div>'+
      '<div id="login-error"></div>'+
      '<div class="field"><label>Usuário</label><input type="text" id="f-user" autocomplete="username" autocapitalize="off"></div>'+
      '<div class="field"><label>Senha</label><input type="password" id="f-pass" autocomplete="current-password"></div>'+
      '<button class="btn btn-primary" id="btn-login">Entrar</button>'+
    '</div></div>';
  var userEl = document.getElementById('f-user'), passEl = document.getElementById('f-pass');
  var btn = document.getElementById('btn-login');
  function attempt(){
    var u = userEl.value.trim(), p = passEl.value;
    if(!u || !p){ showLoginError('Informe usuário e senha.'); return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    DB.login(u, p).then(function(user){
      if(!user){ showLoginError('Usuário ou senha inválidos.'); btn.disabled=false; btn.textContent='Entrar'; return; }
      setSession(user);
      renderApp();
    }).catch(function(err){
      showLoginError('Não foi possível conectar ao servidor. Verifique sua internet.');
      btn.disabled=false; btn.textContent='Entrar';
    });
  }
  function showLoginError(msg){ document.getElementById('login-error').innerHTML = '<div class="error-msg">'+esc(msg)+'</div>'; }
  btn.addEventListener('click', attempt);
  passEl.addEventListener('keydown', function(e){ if(e.key==='Enter') attempt(); });
}

/* ============ HOME ============ */
function renderHome(){
  app.innerHTML =
    topbarHtml('Estoque Messias', {sub: SESSION.name}) +
    '<div class="view">'+
      '<div class="op-grid">'+
        '<button class="op-btn" id="op-armazenagem"><span class="ic">📥</span><div><div class="lbl">ARMAZENAGEM</div><div class="sub">Guardar itens recebidos</div></div></button>'+
        '<button class="op-btn" id="op-separacao"><span class="ic">📤</span><div><div class="lbl">SEPARAÇÃO</div><div class="sub">Retirar itens para pedidos</div></div></button>'+
        '<button class="op-btn" id="op-conferencia"><span class="ic">🔍</span><div><div class="lbl">CONFERÊNCIA</div><div class="sub">Conferir pedidos separados</div></div></button>'+
      '</div>'+
      '<button class="btn btn-ghost" style="margin-top:22px" id="btn-logout">Sair</button>'+
    '</div>';
  document.getElementById('op-armazenagem').addEventListener('click', ArmazenagemFlow.start);
  document.getElementById('op-separacao').addEventListener('click', SeparacaoFlow.list);
  document.getElementById('op-conferencia').addEventListener('click', ConferenciaFlow.list);
  document.getElementById('btn-logout').addEventListener('click', function(){ clearSession(); renderApp(); });
}
function bindBack(fn){
  var b = document.getElementById('btn-back');
  if(b) b.addEventListener('click', function(){
    if(ACTIVE_SCAN){ try{ ACTIVE_SCAN.destroy(); }catch(e){} ACTIVE_SCAN=null; }
    fn();
  });
}
/* Rede de segurança: se a aba for fechada/recarregada com a câmera ligada,
   libera o dispositivo em vez de deixá-lo preso até o navegador encerrar o processo. */
window.addEventListener('pagehide', function(){
  if(ACTIVE_SCAN){ try{ ACTIVE_SCAN.destroy(); }catch(e){} ACTIVE_SCAN=null; }
});

/* ============ MÓDULO DE BIPAGEM (câmera real + digitação manual) ============
   cfg = {
     containerId, title, subtitle, instruction, expectedDisplay,
     validate(code) -> {ok:true, matched} | {ok:false, gotDisplay},
     onAccept(matched, code) -> keepOpen (bool)
   }
*/
var ACTIVE_SCAN = null;
function mountScanStep(cfg){
  if(ACTIVE_SCAN){ try{ ACTIVE_SCAN.destroy(); }catch(e){} ACTIVE_SCAN=null; }
  var container = document.getElementById(cfg.containerId);
  if(!container) return { destroy:function(){} };
  var destroyed = false, cameraStop = null, method = 'camera';
  var lastCode = null, lastAt = 0;

  function destroy(){
    if(destroyed) return; destroyed = true;
    if(cameraStop){ try{ cameraStop(); }catch(e){} cameraStop=null; }
    if(ACTIVE_SCAN===session) ACTIVE_SCAN=null;
  }
  var session = { destroy: destroy };
  ACTIVE_SCAN = session;

  function setStatus(kind, text){
    var el = container.querySelector('.scan-status-badge');
    if(el){ el.className='scan-status-badge scan-status-'+kind; el.textContent=text; }
  }
  function setLastReading(code, ok){
    var el = container.querySelector('.last-reading');
    if(!el) return;
    el.innerHTML = code ?
      '<div class="row"><span class="k">Última leitura</span><span class="v">'+esc(code)+'</span></div>'+
      '<div class="row"><span class="k">Status</span><span>'+(ok?'✅ Confirmado':'❌ Não confere')+'</span></div>'
      : '<div style="color:var(--text-dim)">Nenhuma leitura ainda.</div>';
  }

  function processScan(raw){
    if(destroyed) return;
    var code = normalizeScanCode(raw);
    if(!code) return;
    var now = Date.now();
    if(code===lastCode && (now-lastAt)<1200) return;
    var result = cfg.validate(code);
    if(result && result.ok){
      lastCode = code; lastAt = now;
      setStatus('good','🟢 Confirmado');
      setLastReading(code, true);
      var mm = container.querySelector('.scan-mismatch'); if(mm) mm.style.display='none';
      beep(true);
      var keepOpen = cfg.onAccept(result.matched, code);
      if(destroyed) return;
      if(!keepOpen) destroy();
    } else {
      setStatus('bad','🔴 Não confere');
      setLastReading(code, false);
      beep(false);
      var mm2 = container.querySelector('.scan-mismatch');
      var detail = (result && result.gotDisplay!==undefined) ? ('Esperado: '+cfg.expectedDisplay+' · Bipado: '+result.gotDisplay) : 'Código não reconhecido.';
      if(mm2){ mm2.textContent = detail; mm2.style.display='block'; }
    }
  }

  container.innerHTML =
    '<div class="item-card"><span class="ic">📦</span><div><div class="name">'+esc(cfg.title)+'</div><div class="info">'+esc(cfg.subtitle)+'</div></div></div>'+
    '<div><span class="scan-status-badge scan-status-idle">🟡 Aguardando bipagem</span></div>'+
    '<div class="scan-instruction">'+esc(cfg.instruction)+'</div>'+
    '<div class="scan-mismatch" style="display:none"></div>'+
    '<div class="scan-methods">'+
      '<button type="button" class="scan-method-btn active" data-m="camera">📷 Câmera</button>'+
      '<button type="button" class="scan-method-btn" data-m="manual">⌨️ Digitar</button>'+
    '</div>'+
    '<div class="scan-panel"></div>'+
    '<div class="last-reading"></div>';
  setLastReading(null);

  var panel = container.querySelector('.scan-panel');
  container.querySelectorAll('.scan-method-btn').forEach(function(b){
    b.addEventListener('click', function(){
      container.querySelectorAll('.scan-method-btn').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
      showMethod(b.getAttribute('data-m'));
    });
  });
  showMethod('camera');

  function showMethod(m){
    method = m;
    if(cameraStop && m!=='camera'){ cameraStop(); cameraStop=null; }
    if(m==='camera') renderCamera(); else renderManual();
  }

  function renderManual(){
    panel.innerHTML = '<div class="manual-row"><input type="text" id="manual-input" placeholder="Digite o código e confirme" autocomplete="off"><button class="btn btn-primary btn-sm" id="manual-btn">OK</button></div>';
    var input = document.getElementById('manual-input');
    var btn = document.getElementById('manual-btn');
    function submit(){ var v=input.value; input.value=''; if(v) processScan(v); }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
    setTimeout(function(){ input.focus(); }, 50);
  }

  function renderCamera(){
    panel.innerHTML = '<div class="cam-activate"><span style="font-size:34px">📷</span><button type="button" class="btn btn-primary" id="cam-activate-btn">Ativar câmera</button></div>';
    document.getElementById('cam-activate-btn').addEventListener('click', requestCamera);
  }

  function requestCamera(){
    if(destroyed || method!=='camera' || cameraStop) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      panel.innerHTML = '<div class="cam-status cam-status-warn">Este navegador não suporta acesso à câmera. Use a digitação manual.</div>';
      return;
    }
    if(!window.isSecureContext){
      panel.innerHTML = '<div class="cam-status cam-status-warn">Este site precisa estar em HTTPS para usar a câmera.</div>';
      return;
    }
    panel.innerHTML = '<div class="cam-status">Solicitando acesso à câmera…</div>';
    openStream({ video:{ facingMode:{ideal:'environment'} }, audio:false });
  }

  function openStream(constraints){
    navigator.mediaDevices.getUserMedia(constraints).then(function(stream){
      if(destroyed || method!=='camera'){ stream.getTracks().forEach(function(t){t.stop();}); return; }
      var stopped = false, raf = null;
      cameraStop = function(){ stopped=true; if(raf) cancelAnimationFrame(raf); try{ stream.getTracks().forEach(function(t){t.stop();}); }catch(e){} };
      panel.innerHTML = '<div class="cam-wrap"><video playsinline muted autoplay></video><div class="cam-frame"></div></div><div class="cam-status">Carregando leitor de QR Code…</div>';
      var videoEl = panel.querySelector('video');
      videoEl.srcObject = stream;
      var statusEl = panel.querySelector('.cam-status');
      ensureJsQr(function(ok){
        if(stopped || destroyed || method!=='camera') return;
        if(!ok){ if(statusEl) statusEl.textContent='Não foi possível carregar o leitor de QR Code. Use a digitação manual.'; return; }
        if(statusEl) statusEl.textContent = 'Aponte a câmera para o QR Code';
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d', {willReadFrequently:true});
        function tick(){
          if(stopped) return;
          if(videoEl.readyState>=2 && videoEl.videoWidth>0){
            canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight;
            try{
              ctx.drawImage(videoEl,0,0,canvas.width,canvas.height);
              var img = ctx.getImageData(0,0,canvas.width,canvas.height);
              var code = window.jsQR(img.data, img.width, img.height, {inversionAttempts:'dontInvert'});
              if(code && code.data) processScan(code.data);
            }catch(e){}
          }
          raf = requestAnimationFrame(tick);
        }
        tick();
      });
    }).catch(function(err){
      var name = err && err.name;
      if(name==='OverconstrainedError'){ openStream({video:true, audio:false}); return; }
      var msg;
      if(name==='NotAllowedError') msg = 'Permissão da câmera negada. Permita o acesso à câmera nas configurações do navegador e tente novamente.';
      else if(name==='NotFoundError') msg = 'Nenhuma câmera foi encontrada neste dispositivo.';
      else if(name==='NotReadableError') msg = 'A câmera está sendo usada por outro aplicativo.';
      else msg = 'Não foi possível acessar a câmera ('+(name||'erro desconhecido')+'). Use a digitação manual.';
      panel.innerHTML = '<div class="cam-status cam-status-warn">'+esc(msg)+'</div><button type="button" class="btn mt8" id="cam-retry">Tentar novamente</button>';
      var retry = document.getElementById('cam-retry');
      if(retry) retry.addEventListener('click', renderCamera);
    });
  }

  return session;
}

var JSQR_STATE = 'idle', JSQR_QUEUE = [];
var JSQR_URLS = ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js','https://cdn.jsdelivr.net/npm/jsqr/dist/jsQR.js'];
function ensureJsQr(cb){
  if(JSQR_STATE==='ready'){ cb(true); return; }
  if(JSQR_STATE==='failed'){ cb(false); return; }
  JSQR_QUEUE.push(cb);
  if(JSQR_STATE==='loading') return;
  JSQR_STATE='loading';
  var i=0;
  function tryNext(){
    if(window.jsQR){ JSQR_STATE='ready'; JSQR_QUEUE.forEach(function(f){f(true);}); JSQR_QUEUE=[]; return; }
    if(i>=JSQR_URLS.length){ JSQR_STATE='failed'; JSQR_QUEUE.forEach(function(f){f(false);}); JSQR_QUEUE=[]; return; }
    var s = document.createElement('script'); s.src = JSQR_URLS[i++];
    s.onload = function(){ if(window.jsQR){ JSQR_STATE='ready'; JSQR_QUEUE.forEach(function(f){f(true);}); JSQR_QUEUE=[]; } else tryNext(); };
    s.onerror = tryNext;
    document.head.appendChild(s);
  }
  tryNext();
}

/* ============ ARMAZENAGEM ============ */
var ArmazenagemFlow = (function(){
  function start(){ renderScanItem(); }

  function renderScanItem(){
    app.innerHTML =
      topbarHtml('Armazenagem', {back:true, sub:'Bipe o item recebido'}) +
      '<div class="view"><div id="scan-area"></div></div>';
    bindBack(renderHome);
    var products = null, locations = null;
    Promise.all([DB.products(), DB.locations()]).then(function(res){
      products = res[0]; locations = res[1];
      mountScanStep({
        containerId: 'scan-area',
        title: 'Identificar item',
        subtitle: 'Bipe o QR Code ou SKU do produto recebido',
        instruction: 'Aponte a câmera para o QR Code do item, ou digite o SKU.',
        expectedDisplay: '(qualquer produto cadastrado)',
        validate: function(code){
          var p = findProductByCode(products, code);
          return p ? { ok:true, matched:p } : { ok:false, gotDisplay: code };
        },
        onAccept: function(product){
          handleProductScanned(product, locations);
          return false;
        }
      });
    }).catch(function(){ document.getElementById('scan-area').innerHTML = '<div class="error-msg">Não foi possível carregar os dados. Verifique sua internet.</div>'; });
  }

  function handleProductScanned(product, locations){
    document.getElementById('scan-area').innerHTML = '<div class="center-msg"><span class="spinner"></span></div>';
    DB.pendingStorageTasks().then(function(tasks){
      var mine = tasks.filter(function(t){ return t.product_id===product.id; });
      if(mine.length===0){
        toast('Nenhuma armazenagem pendente para "'+product.name+'".', 'bad');
        renderScanItem();
        return;
      }
      var byVariation = {};
      mine.forEach(function(t){
        var key = t.variation_id || '__none__';
        if(!byVariation[key]) byVariation[key] = { variationId: t.variation_id||null, qty:0, taskIds:[], suggestedLocationId:null };
        byVariation[key].qty += Number(t.qty_pending);
        byVariation[key].taskIds.push(t.id);
        if(!byVariation[key].suggestedLocationId) byVariation[key].suggestedLocationId = t.suggested_location_id;
      });
      var groups = Object.keys(byVariation).map(function(k){ return byVariation[k]; });
      if(groups.length===1){ runStorageGroup(product, groups[0], locations); }
      else { renderVariationPicker(product, groups, locations); }
    }).catch(function(){ toast('Erro ao consultar tarefas de armazenagem.','bad'); renderScanItem(); });
  }

  function renderVariationPicker(product, groups, locations){
    var html = topbarHtml('Armazenagem', {back:true, sub:product.name}) +
      '<div class="view"><p>Este item tem mais de uma variação pendente. Selecione qual está em mãos:</p>';
    groups.forEach(function(g, idx){
      html += '<button class="varpick-item" data-idx="'+idx+'"><strong>'+esc(variationName(product,g.variationId)||'(sem variação)')+'</strong><div class="info" style="color:var(--text-dim);font-size:12.5px">Quantidade: '+g.qty+'</div></button>';
    });
    html += '</div>';
    app.innerHTML = html;
    bindBack(renderScanItem);
    document.querySelectorAll('.varpick-item').forEach(function(b){
      b.addEventListener('click', function(){ runStorageGroup(product, groups[Number(b.getAttribute('data-idx'))], locations); });
    });
  }

  function runStorageGroup(product, group, locations){
    var chosenLocation = null;
    renderLocationStep();

    function renderLocationStep(){
      var suggested = group.suggestedLocationId ? locations.find(function(l){return l.id===group.suggestedLocationId;}) : null;
      app.innerHTML =
        topbarHtml('Armazenagem', {back:true, sub: productLabel(product, group.variationId)}) +
        '<div class="view">'+
          (suggested ? '<p>Local sugerido: <strong>'+esc(suggested.code)+'</strong></p>' : '<p>Nenhum local sugerido automaticamente — bipe a prateleira onde vai guardar.</p>')+
          '<div id="scan-area"></div>'+
        '</div>';
      bindBack(renderScanItem);
      mountScanStep({
        containerId: 'scan-area',
        title: productLabel(product, group.variationId),
        subtitle: 'Quantidade: '+group.qty+' un.',
        instruction: 'Vá até a posição e bipe o QR Code da prateleira.',
        expectedDisplay: suggested ? suggested.code : '(qualquer localização válida)',
        validate: function(code){
          var loc = findLocationByCode(locations, code);
          return loc ? {ok:true, matched:loc} : {ok:false, gotDisplay: code};
        },
        onAccept: function(loc){ chosenLocation = loc; renderConfirmStep(); return false; }
      });
    }

    function renderConfirmStep(){
      app.innerHTML =
        topbarHtml('Armazenagem', {back:true, sub: productLabel(product, group.variationId)}) +
        '<div class="view">'+
          '<div class="qty-confirm">'+
            '<div class="lbl">Local: '+esc(chosenLocation.code)+'</div>'+
            '<div class="num">'+group.qty+'</div>'+
            '<div class="lbl">unidades a armazenar</div>'+
          '</div>'+
          '<p style="text-align:center;color:var(--text-dim);font-size:13px">Confirme se a quantidade e o local estão corretos.</p>'+
          '<button class="btn btn-primary" id="btn-confirm-storage">Confirmar armazenagem</button>'+
        '</div>';
      bindBack(renderLocationStep);
      document.getElementById('btn-confirm-storage').addEventListener('click', function(){
        var btn = this; btn.disabled = true; btn.textContent = 'Salvando…';
        DB.addStock(product.id, group.variationId, chosenLocation.id, group.qty)
          .then(function(){ return DB.addMovement(Object.assign({ type:'entrada', product_id:product.id, variation_id:group.variationId, quantity:group.qty, location_id:chosenLocation.id, ref_type:'armazenagem_coletor', note:'Armazenagem via coletor' }, auditCtx())); })
          .then(function(){ return DB.closeStorageTasks(group.taskIds); })
          .then(function(){ return DB.addAudit(Object.assign({ action:'Armazenou item', entity_type:'estoque', entity_id:product.id, details: group.qty+' un. em '+chosenLocation.code }, auditCtx())); })
          .then(function(){ toast('Item armazenado com sucesso.','good'); renderScanItem(); })
          .catch(function(){ toast('Erro ao salvar. Tente novamente.','bad'); btn.disabled=false; btn.textContent='Confirmar armazenagem'; });
      });
    }
  }

  return { start: start };
})();

/* ============ SEPARAÇÃO ============ */
var SeparacaoFlow = (function(){
  function list(){
    app.innerHTML = topbarHtml('Separação', {back:true}) + '<div class="view"><div id="list-area"><div class="center-msg"><span class="spinner"></span></div></div></div>';
    bindBack(renderHome);
    DB.salesOrdersByStatus(['AGUARDANDO_SEPARACAO','EM_SEPARACAO']).then(function(orders){
      orders.sort(function(a,b){ if(a.priority!==b.priority) return a.priority==='ALTA'?-1:1; return new Date(a.created_at)-new Date(b.created_at); });
      var area = document.getElementById('list-area');
      if(orders.length===0){ area.innerHTML = '<div class="empty-state">Nenhum pedido aguardando separação.</div>'; return; }
      area.innerHTML = orders.map(function(o){
        return '<div class="list-item"><div><div class="code">'+esc(o.code)+'</div><div class="meta">'+(o.channel==='LOJA'?'Loja física':'Online')+' · <span class="'+(o.priority==='ALTA'?'priority-alta':'')+'">'+(o.priority==='ALTA'?'Alta':'Normal')+'</span></div></div><button class="btn btn-primary btn-sm" data-open="'+o.id+'">'+(o.status==='EM_SEPARACAO'?'Continuar':'Iniciar')+'</button></div>';
      }).join('');
      area.querySelectorAll('[data-open]').forEach(function(b){ b.addEventListener('click', function(){ openOrder(b.getAttribute('data-open')); }); });
    }).catch(function(){ document.getElementById('list-area').innerHTML = '<div class="error-msg">Erro ao carregar pedidos.</div>'; });
  }

  function openOrder(orderId){
    app.innerHTML = topbarHtml('Separação', {back:true}) + '<div class="view"><div class="center-msg"><span class="spinner"></span></div></div>';
    bindBack(list);
    Promise.all([DB.orderItems(orderId), DB.products(), DB.locations()]).then(function(res){
      var items = res[0], products = res[1], locations = res[2];
      prepareAndRun(orderId, items, products, locations);
    }).catch(function(){ toast('Erro ao carregar pedido.','bad'); list(); });
  }

  function prepareAndRun(orderId, items, products, locations){
    var pending = items.filter(function(i){ return !i.separated; });
    var needsLocation = pending.filter(function(i){ return !i.location_id; });
    var assignPromises = needsLocation.map(function(it){
      return DB.stockLocationsFor(it.product_id, it.variation_id).then(function(stocks){
        var best = stocks[0];
        it.location_id = best ? best.location_id : null;
        return DB.updateItem(it.id, { location_id: it.location_id });
      });
    });
    Promise.all(assignPromises).then(function(){
      return DB.updateOrder(orderId, { status:'EM_SEPARACAO' });
    }).then(function(){
      runItemLoop(orderId, items, products, locations);
    }).catch(function(){ toast('Erro ao preparar separação.','bad'); list(); });
  }

  function runItemLoop(orderId, items, products, locations){
    var stepState = 'location';
    step();

    function step(){
      var item = items.find(function(i){ return !i.separated; });
      if(!item){
        DB.updateOrder(orderId, {status:'EM_CONFERENCIA'})
          .then(function(){ return DB.addAudit(Object.assign({action:'Concluiu separação', entity_type:'pedido_venda', entity_id:orderId}, auditCtx())); })
          .then(function(){ toast('Pedido separado. Enviado para conferência.','good'); list(); })
          .catch(function(){ toast('Erro ao concluir separação.','bad'); list(); });
        return;
      }
      var product = products.find(function(p){ return p.id===item.product_id; });
      var loc = locations.find(function(l){ return l.id===item.location_id; });
      var doneCount = items.filter(function(i){return i.separated;}).length;

      if(!loc){
        app.innerHTML = topbarHtml('Separação', {back:true}) +
          '<div class="view"><div class="error-msg">Não há estoque de "'+esc(productLabel(product,item.variation_id))+'" em nenhuma localização.</div>'+
          '<button class="btn" id="btn-skip">Pular item</button></div>';
        bindBack(list);
        document.getElementById('btn-skip').addEventListener('click', function(){
          DB.updateItem(item.id, {separated:true, qty:0}).then(function(){ item.separated=true; step(); });
        });
        return;
      }

      app.innerHTML = topbarHtml('Separação', {back:true, sub:'Item '+(doneCount+1)+' de '+items.length}) +
        '<div class="view"><div id="scan-area"></div></div>';
      bindBack(function(){ list(); });

      if(stepState==='location'){
        mountScanStep({
          containerId:'scan-area', title: productLabel(product, item.variation_id),
          subtitle: 'Quantidade: '+item.qty+' un. · Local: '+loc.code,
          instruction: 'Vá até '+loc.code+' e bipe o QR Code da prateleira.',
          expectedDisplay: loc.code,
          validate: function(code){ return scanMatches(code, [loc.qr_payload, loc.code]) ? {ok:true,matched:true} : {ok:false, gotDisplay:code}; },
          onAccept: function(){ stepState='product'; step(); return false; }
        });
      } else if(stepState==='product'){
        mountScanStep({
          containerId:'scan-area', title: productLabel(product, item.variation_id),
          subtitle: 'Local confirmado: '+loc.code,
          instruction: 'Bipe o QR Code do produto ou digite o SKU '+(product?product.sku:'')+'.',
          expectedDisplay: product?product.sku:'',
          validate: function(code){ return findProductByCode([product], code) ? {ok:true,matched:true} : {ok:false, gotDisplay:code}; },
          onAccept: function(){ stepState='confirm'; step(); return false; }
        });
      } else if(stepState==='confirm'){
        app.querySelector('.view').innerHTML =
          '<div class="qty-confirm"><div class="lbl">'+esc(productLabel(product,item.variation_id))+'</div><div class="num">'+item.qty+'</div><div class="lbl">unidades para separar</div></div>'+
          '<p style="text-align:center;color:var(--text-dim);font-size:13px">Local e produto confirmados. Confirme a quantidade retirada.</p>'+
          '<button class="btn btn-primary" id="btn-confirm-pick">Confirmar quantidade</button>';
        document.getElementById('btn-confirm-pick').addEventListener('click', function(){
          var btn=this; btn.disabled=true; btn.textContent='Salvando…';
          DB.addStock(item.product_id, item.variation_id, item.location_id, -item.qty)
            .then(function(){ return DB.addMovement(Object.assign({type:'saida', product_id:item.product_id, variation_id:item.variation_id, quantity:item.qty, location_id:item.location_id, ref_type:'venda', ref_id:orderId, note:'Separação via coletor'}, auditCtx())); })
            .then(function(){ return DB.updateItem(item.id, {separated:true}); })
            .then(function(){ return DB.addAudit(Object.assign({action:'Separou item', entity_type:'pedido_venda', entity_id:orderId, details:productLabel(product,item.variation_id)+' x'+item.qty}, auditCtx())); })
            .then(function(){ item.separated = true; stepState='location'; step(); })
            .catch(function(){ toast('Erro ao salvar. Tente novamente.','bad'); btn.disabled=false; btn.textContent='Confirmar quantidade'; });
        });
      }
    }
  }

  return { list: list };
})();

/* ============ CONFERÊNCIA ============ */
var ConferenciaFlow = (function(){
  function list(){
    app.innerHTML = topbarHtml('Conferência', {back:true}) + '<div class="view"><div id="list-area"><div class="center-msg"><span class="spinner"></span></div></div></div>';
    bindBack(renderHome);
    DB.salesOrdersByStatus(['EM_CONFERENCIA']).then(function(orders){
      var area = document.getElementById('list-area');
      if(orders.length===0){ area.innerHTML = '<div class="empty-state">Nenhum pedido aguardando conferência.</div>'; return; }
      area.innerHTML = orders.map(function(o){
        return '<div class="list-item"><div><div class="code">'+esc(o.code)+'</div><div class="meta">'+(o.channel==='LOJA'?'Loja física':'Online')+'</div></div><button class="btn btn-primary btn-sm" data-open="'+o.id+'">Conferir</button></div>';
      }).join('');
      area.querySelectorAll('[data-open]').forEach(function(b){ b.addEventListener('click', function(){ openOrder(b.getAttribute('data-open')); }); });
    }).catch(function(){ document.getElementById('list-area').innerHTML = '<div class="error-msg">Erro ao carregar pedidos.</div>'; });
  }

  function openOrder(orderId){
    app.innerHTML = topbarHtml('Conferência', {back:true}) + '<div class="view"><div class="center-msg"><span class="spinner"></span></div></div>';
    bindBack(list);
    Promise.all([DB.orderItems(orderId), DB.products()]).then(function(res){
      runItemLoop(orderId, res[0], res[1]);
    }).catch(function(){ toast('Erro ao carregar pedido.','bad'); list(); });
  }

  function runItemLoop(orderId, items, products){
    step();
    function step(){
      var item = items.find(function(i){ return !i.conferred; });
      if(!item){
        DB.updateOrder(orderId, {status:'CONFERIDO'})
          .then(function(){ return DB.addAudit(Object.assign({action:'Concluiu conferência', entity_type:'pedido_venda', entity_id:orderId}, auditCtx())); })
          .then(function(){ toast('Pedido conferido.','good'); list(); })
          .catch(function(){ toast('Erro ao concluir conferência.','bad'); list(); });
        return;
      }
      var product = products.find(function(p){ return p.id===item.product_id; });
      var doneCount = items.filter(function(i){return i.conferred;}).length;
      app.innerHTML = topbarHtml('Conferência', {back:true, sub:'Item '+(doneCount+1)+' de '+items.length}) +
        '<div class="view"><div id="scan-area"></div></div>';
      bindBack(function(){ list(); });
      mountScanStep({
        containerId:'scan-area', title: productLabel(product, item.variation_id),
        subtitle: 'Quantidade separada: '+item.qty+' un.',
        instruction: 'Bipe o QR Code do produto ou digite o SKU '+(product?product.sku:'')+'.',
        expectedDisplay: product?product.sku:'',
        validate: function(code){ return findProductByCode([product], code) ? {ok:true,matched:true} : {ok:false, gotDisplay:code}; },
        onAccept: function(){
          app.querySelector('.view').innerHTML =
            '<div class="qty-confirm"><div class="lbl">'+esc(productLabel(product,item.variation_id))+'</div><div class="num">'+item.qty+'</div><div class="lbl">unidades separadas</div></div>'+
            '<p style="text-align:center;color:var(--text-dim);font-size:13px">Confira se a quantidade corresponde ao que foi separado.</p>'+
            '<button class="btn btn-primary" id="btn-confirm-conf">Confirmar item</button>';
          document.getElementById('btn-confirm-conf').addEventListener('click', function(){
            var btn=this; btn.disabled=true; btn.textContent='Salvando…';
            DB.updateItem(item.id, {conferred:true})
              .then(function(){ return DB.addAudit(Object.assign({action:'Conferiu item', entity_type:'pedido_venda', entity_id:orderId, details:productLabel(product,item.variation_id)}, auditCtx())); })
              .then(function(){ item.conferred = true; step(); })
              .catch(function(){ toast('Erro ao salvar. Tente novamente.','bad'); btn.disabled=false; btn.textContent='Confirmar item'; });
          });
          return false;
        }
      });
    }
  }

  return { list: list };
})();

/* ============ BOOT ============ */
renderApp();

})();
