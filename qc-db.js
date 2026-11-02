/* QuickCart DB router — decides which Firebase database a session reads/writes.
   MAIN  = your central database: login directory (/users), /dbmap (username -> customer DB URL).
   A customer with their own Firebase has ALL their business data (products, orders, staff, roles…) in THEIR database. */
(function(){
  if (window.QCDB) return;
  var MAIN = 'https://sneakerai-c96f0-default-rtdb.firebaseio.com', L = localStorage;
  var KEYS = ['qc_db_url','qc_owner','qc_role','qc_modules','qc_is_staff','qc_full_name'];
  function clean(u){ return String(u||'').trim().replace(/\.json.*$/i,'').replace(/\/+$/,''); }
  function valid(u){ return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)?\.(firebaseio\.com|firebasedatabase\.app)$/i.test(u); }
  function enc(u){ return encodeURIComponent(u); }
  function owner(){ return L.getItem('qc_owner') || L.getItem('qc_logged_user') || ''; }
  function base(){
    var d = L.getItem('qc_db_url'); if (d) return d;
    var o = owner(); return (!o || o === 'admin') ? MAIN : MAIN + '/users/' + enc(o);
  }
  function lookup(u, fresh){            // username -> customer DB url ('' if they use the shared DB)
    if (!u || u === 'admin') return '';
    var ck = 'qcdb_' + u; if (!fresh){ var c = sessionStorage.getItem(ck); if (c !== null) return c; }
    var out = '';
    try { var x = new XMLHttpRequest(); x.open('GET', MAIN + '/dbmap/' + enc(u) + '.json', false); x.send();
      if (x.status === 200){ var v = JSON.parse(x.responseText); if (typeof v === 'string' && valid(v)) out = v; } } catch(e){}
    try { sessionStorage.setItem(ck, out); } catch(e){}
    return out;
  }
  function baseFor(u){ if (!u || u === 'admin') return MAIN; var d = lookup(u); return d || MAIN + '/users/' + enc(u); }
  function clearSession(){ KEYS.forEach(function(k){ L.removeItem(k); }); }
  function setSession(rec){                // call right after a successful login with the directory record
    clearSession(); if (!rec) return;
    if (rec.isStaff && rec.owner){
      L.setItem('qc_is_staff', '1'); L.setItem('qc_owner', rec.owner); L.setItem('qc_role', rec.role || '');
      L.setItem('qc_modules', JSON.stringify(Array.isArray(rec.modules) ? rec.modules : []));
      L.setItem('qc_full_name', rec.fullname || rec.username || '');
      var d = lookup(rec.owner, true) || rec.dbUrl || ''; if (d && valid(d)) L.setItem('qc_db_url', d);
    } else {
      var own = rec.username || '', d2 = rec.dbUrl || lookup(own, true); if (d2 && valid(d2)) L.setItem('qc_db_url', d2);
    }
  }
  function isStaff(){ return L.getItem('qc_is_staff') === '1'; }
  function can(mod){
    if (!isStaff()) return true;
    try { return JSON.parse(L.getItem('qc_modules') || '[]').indexOf(mod) > -1; } catch(e){ return false; }
  }
  /* Run: verify a customer's Firebase, seed it, and register it for this username */
  async function provision(url, username, rolesDefault){
    url = clean(url);
    if (!username) return { ok:false, msg:'Enter the username first (above), then press Run.' };
    if (!valid(url)) return { ok:false, msg:'That doesn\'t look like a Realtime Database URL. It should look like https://their-project-default-rtdb.firebaseio.com' };
    var r;
    try { r = await fetch(url + '/.json?shallow=true'); } catch(e){ return { ok:false, msg:'Could not reach that database. Check the URL and your internet.' }; }
    if (r.status === 401 || r.status === 403) return { ok:false, msg:'Permission denied. In their Firebase console → Realtime Database → Rules, allow read/write, publish, then press Run again.' };
    if (!r.ok) return { ok:false, msg:'Database not found (error ' + r.status + '). Make sure Realtime Database is created in their project and the URL is exact.' };
    try {
      var meta = { owner:username, app:'quickcart', provisionedAt:new Date().toISOString(), v:1 };
      var w = await fetch(url + '/settings/meta.json', { method:'PUT', body:JSON.stringify(meta) });
      if (!w.ok) return { ok:false, msg:'Connected, but writing was blocked. Their rules must allow write access.' };
      var rr = await fetch(url + '/roles.json'); var has = rr.ok ? await rr.json() : null;
      if (!has && rolesDefault) await fetch(url + '/roles.json', { method:'PUT', body:JSON.stringify(rolesDefault) });
      var m = await fetch(MAIN + '/dbmap/' + enc(username) + '.json', { method:'PUT', body:JSON.stringify(url) });
      if (!m.ok) return { ok:false, msg:'Database is ready, but could not register it in your main database.' };
      try { sessionStorage.removeItem('qcdb_' + username); } catch(e){}
    } catch(e){ return { ok:false, msg:'Setup failed: ' + e.message }; }
    return { ok:true, url:url, msg:'Connected ✓ Their database is set up and linked to "' + username + '".' };
  }

  /* Staff login: company ID (owner's store email) + staff username + password. */
  async function staffLogin(companyId, username, password){
    companyId = String(companyId||'').trim().toLowerCase();
    username  = String(username||'').trim().toLowerCase();
    if (!companyId || !username || !password) return { ok:false, msg:'Enter the Company ID, your username and your password.' };
    var data;
    try { var r = await fetch(MAIN + '/users.json'); data = await r.json(); }
    catch(e){ return { ok:false, msg:'Login error. Please check your connection.' }; }
    if (!data) return { ok:false, msg:'Company ID not found. Ask your boss for the correct Company ID.' };
    var all = Object.values(data);
    var owner = (companyId === 'admin@quickcart.ng' || companyId === 'admin')
      ? { username:'admin', email:'admin@quickcart.ng', plan:'premium', status:'active', businessName:'QuickCart' }
      : all.find(function(u){ return !u.isStaff && String(u.email||'').toLowerCase() === companyId; });
    if (!owner) return { ok:false, msg:'Company ID not found. Use the store email your boss subscribed with.' };
    var ownerName = String(owner.username||'').toLowerCase();
    var mine = all.filter(function(u){ return u.isStaff && String(u.owner||'').toLowerCase() === ownerName && String(u.username||'').toLowerCase() === username; });
    if (!mine.length) return { ok:false, msg:'No staff with that username in this company.' };
    var rec = mine.find(function(u){ return u.password === btoa(password); });
    if (!rec) return { ok:false, msg:'Wrong password. Please try again.' };
    if (rec.status && rec.status !== 'active') return { ok:false, msg:'Your account is suspended. Please contact your boss.' };
    if (ownerName !== 'admin'){
      var now = new Date();
      var ok = (owner.trialEnds && new Date(owner.trialEnds) > now) || (owner.subExpires && new Date(owner.subExpires) > now) || owner.status === 'active';
      if (!ok) return { ok:false, msg:'This company\'s subscription has expired. Please tell your boss to renew.' };
    }
    return { ok:true, rec:rec, owner:owner };
  }
  function finishStaffLogin(res){
    var rec = res.rec, owner = res.owner;
    setSession(rec);
    L.setItem('qc_logged_user', rec.username);
    L.setItem('qc_sub_plan', owner.plan || 'staff');
    L.setItem('qc_sub_email', rec.email || '');
    L.setItem('qc_biz_name', owner.businessName || '');
  }
  window.QCDB = { staffLogin:staffLogin, finishStaffLogin:finishStaffLogin, MAIN:MAIN, clean:clean, valid:valid, owner:owner, base:base, baseFor:baseFor, lookup:lookup,
    setSession:setSession, clearSession:clearSession, isStaff:isStaff, can:can, provision:provision };
})();
