/* QuickCart Live Layer — tiny runtime shared by store.html (visitors) and page-editor.html (edit mode).
   Per-store data lives at  <store namespace>/settings/page_overrides  so one store never affects another. */
(function(){
  if (window.QCLive) return;
  var FB = 'https://sneakerai-c96f0-default-rtdb.firebaseio.com';
  var qs = new URLSearchParams(location.search);
  var EDIT = qs.get('edit') === '1' && window.parent !== window;

  function ns(){ try { if (typeof getStoreNS === 'function') return getStoreNS(); } catch(e){}
    var u = qs.get('store') || localStorage.getItem('qc_store_owner') || localStorage.getItem('qc_logged_user') || '';
    return (u && u !== 'admin') ? FB + '/users/' + encodeURIComponent(u) : FB; }
  function url(){ return ns() + '/settings/page_overrides.json'; }

  var data = { vars:{}, fonts:{}, css:'', items:{} };   // items: selector -> {html,at:{},st:{},hide}
  var orig = {};                                         // selector -> {html, at:{}}
  var hist = [], fut = [], lastPush = 0, selEl = null, hovEl = null, editing = null, dirty = false;
  var styleTag, uiTag;

  /* ---------- helpers ---------- */
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function ignore(el){ return !el || el.nodeType !== 1 || el === document.documentElement || el === document.body ||
    /^(SCRIPT|STYLE|LINK|META|HEAD|NOSCRIPT)$/.test(el.tagName) || el.closest('#qc-live-ui'); }
  function sel(el){
    var parts = [];
    while (el && el !== document.body && el.nodeType === 1){
      if (el.id && !/\d{5,}/.test(el.id)) { parts.unshift('#' + CSS.escape(el.id)); break; }
      var i = 1, s = el; while ((s = s.previousElementSibling)) i++;
      parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + i + ')');
      el = el.parentElement;
    }
    if (parts[0] && parts[0][0] !== '#') parts.unshift('body');
    return parts.join('>');
  }
  function q(s){ try { return document.querySelector(s); } catch(e){ return null; } }
  function item(s){ return data.items[s] || (data.items[s] = { at:{}, st:{} }); }
  function safeUrl(u){ u = String(u||'').trim(); return /^(https?:|data:image\/|\/|#|mailto:|tel:|https?%3A)/i.test(u) || u === '' ? u : ''; }
  function clean(html){
    var t = document.createElement('template'); t.innerHTML = String(html||'');
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(function(n){ n.remove(); });
    t.content.querySelectorAll('*').forEach(function(n){
      [].slice.call(n.attributes).forEach(function(a){
        var k = a.name.toLowerCase();
        if (k.indexOf('on') === 0 || ((k === 'href' || k === 'src') && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
      });
    });
    return t.innerHTML;
  }
  function cssClean(c){ return String(c||'').replace(/<\/?style[^>]*>/gi,'').replace(/@import[^;]*;?/gi,'').replace(/javascript:/gi,'').replace(/expression\s*\(/gi,''); }

  /* ---------- apply ---------- */
  function ensureTags(){
    if (!styleTag){ styleTag = document.createElement('style'); styleTag.id = 'qc-live-css'; document.head.appendChild(styleTag); }
  }
  var FONTS = { body:'body,button,input,select,textarea', head:'h1,h2,h3,h4,.hero-h,.hero-headline,.logo-text' };
  function loadFont(name){
    if (!name || /^(system-ui|Arial|Georgia|Times New Roman|Courier New)$/i.test(name)) return;
    var id = 'qcf-' + name.replace(/\W/g,''); if (document.getElementById(id)) return;
    var l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g,'+') + ':wght@400;600;700;800&display=swap';
    document.head.appendChild(l);
  }
  function buildCSS(){
    var out = '';
    Object.keys(data.fonts).forEach(function(k){
      var f = String(data.fonts[k]||'').replace(/[^\w\s-]/g,''); if (!f || !FONTS[k]) return;
      loadFont(f); out += FONTS[k] + '{font-family:"' + f + '",system-ui,sans-serif !important}\n';
    });
    Object.keys(data.items).forEach(function(s){
      var it = data.items[s], rules = '';
      Object.keys(it.st||{}).forEach(function(p){
        var v = String(it.st[p]); var isUrl = /^url\("(https?:\/\/|data:image\/)[^"\\<>{}]*"\)$/.test(v); if (!isUrl && !/^[\w\s#%.,()\/:"'-]+$/.test(v)) return;
        rules += p + ':' + v + ' !important;';
      });
      if (it.hide) rules += EDIT ? 'opacity:.25 !important;' : 'display:none !important;';
      if (rules) out += s + '{' + rules + '}\n';
    });
    return out + cssClean(data.css);
  }
  function applyVars(){
    var r = document.documentElement;
    Object.keys(data.vars).forEach(function(k){
      var v = data.vars[k]; if (!v) return;
      r.style.setProperty(k, v, 'important');
      if (k === '--text') r.style.setProperty('--black', v, 'important');
      if (k === '--accent') r.style.setProperty('--accent2', v, 'important');
    });
  }
  function applyDOM(){
    Object.keys(data.items).forEach(function(s){
      var it = data.items[s], el = q(s); if (!el || el === editing) return;
      if (it.html != null){ if (!orig[s]) orig[s] = { html: el.innerHTML, at:{} };
        var h = clean(it.html); if (el.innerHTML !== h) el.innerHTML = h; }
      Object.keys(it.at||{}).forEach(function(a){
        if (!/^(src|href|alt|placeholder|title)$/.test(a)) return;
        orig[s] = orig[s] || { at:{} }; if (!(a in orig[s].at)) orig[s].at[a] = el.getAttribute(a);
        var v = (a === 'src' || a === 'href') ? safeUrl(it.at[a]) : it.at[a];
        if (el.getAttribute(a) !== v) el.setAttribute(a, v);
        if (a === 'src') el.removeAttribute('srcset');
      });
    });
  }
  var mo, moT;
  function render(){
    ensureTags(); styleTag.textContent = buildCSS(); applyVars();
    if (mo) mo.disconnect(); applyDOM(); observe();
  }
  function observe(){
    if (!mo) mo = new MutationObserver(function(){ clearTimeout(moT); moT = setTimeout(function(){ if (mo) mo.disconnect(); applyDOM(); observe(); }, 120); });
    mo.observe(document.body, { childList:true, subtree:true });
  }
  function revertGone(prev){   // put back originals for anything removed by undo/reset
    Object.keys(prev.items).forEach(function(s){
      var p = prev.items[s], n = data.items[s], el = q(s), o = orig[s]; if (!el || !o) return;
      if (p.html != null && (!n || n.html == null) && o.html != null) el.innerHTML = o.html;
      Object.keys(p.at||{}).forEach(function(a){
        if (!n || !n.at || !(a in n.at)){ if (o.at && o.at[a] != null) el.setAttribute(a, o.at[a]); else el.removeAttribute(a); }
      });
    });
    Object.keys(prev.vars).forEach(function(k){ if (!data.vars[k]) document.documentElement.style.removeProperty(k); });
  }

  /* ---------- data in/out ---------- */
  function pack(){
    var items = [];
    Object.keys(data.items).forEach(function(s){
      var it = data.items[s]; if (it.html == null && !it.hide && !Object.keys(it.at||{}).length && !Object.keys(it.st||{}).length) return;
      items.push({ s:s, html: it.html == null ? null : it.html, hide: it.hide ? 1 : 0, at: it.at||{}, st: it.st||{} });
    });
    return { v:1, vars:data.vars, fonts:data.fonts, css:data.css||'', items:items, updated:Date.now() };
  }
  function unpack(raw){
    var d = { vars:{}, fonts:{}, css:'', items:{} };
    if (raw){
      d.vars = raw.vars || {}; d.fonts = raw.fonts || {}; d.css = raw.css || '';
      var arr = raw.items || []; if (!Array.isArray(arr)) arr = Object.keys(arr).map(function(k){ return arr[k]; });
      arr.forEach(function(i){ if (i && i.s) d.items[i.s] = { html: i.html == null ? undefined : i.html, hide: !!i.hide, at: i.at||{}, st: i.st||{} }; });
    }
    return d;
  }

  /* ---------- history ---------- */
  function snap(force){
    var now = Date.now();
    if (!force && now - lastPush < 700 && hist.length) { return; }
    hist.push(clone(data)); if (hist.length > 60) hist.shift(); fut = []; lastPush = now;
  }
  function changed(){
    dirty = true; render(); emit('change');
    if (EDIT) try { localStorage.setItem('qc_draft_' + ns(), JSON.stringify(pack())); } catch(e){}
  }
  function emit(type, extra){
    if (!EDIT) return;
    var m = { qc:type, dirty:dirty, canUndo:hist.length > 0, canRedo:fut.length > 0 };
    if (extra) for (var k in extra) m[k] = extra[k];
    try { parent.postMessage(m, '*'); } catch(e){}
  }

  /* ---------- selection (edit mode) ---------- */
  function info(el){
    var cs = getComputedStyle(el), s = sel(el), it = data.items[s] || {};
    var hasText = !!(el.textContent || '').trim() && !/^(IMG|INPUT|SELECT|VIDEO|SVG)$/i.test(el.tagName);
    var a = el.closest('a');
    return { sel:s, tag:el.tagName.toLowerCase(), label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : (el.classList[0] ? '.' + el.classList[0] : '')),
      text: hasText, img: el.tagName === 'IMG', src: el.getAttribute('src') || '', link: a ? (a.getAttribute('href') || '') : '', isLink: !!a,
      color: cs.color, bg: cs.backgroundColor, fontSize: parseFloat(cs.fontSize) || 16, fontWeight: cs.fontWeight, textAlign: cs.textAlign,
      padding: parseFloat(cs.paddingTop) || 0, radius: parseFloat(cs.borderTopLeftRadius) || 0, opacity: Math.round((parseFloat(cs.opacity) || 1) * 100),
      hidden: !!it.hide, bgImage: (it.st && it.st['background-image']) || '', hasParent: !!(el.parentElement && !ignore(el.parentElement)), hasChild: !!el.firstElementChild };
  }
  function select(el){
    if (selEl) selEl.removeAttribute('data-qc-sel');
    selEl = el; if (!el) { emit('select', { info:null }); return; }
    el.setAttribute('data-qc-sel', '1'); emit('select', { info: info(el) });
  }
  function stopEdit(){
    if (!editing) return; var el = editing; editing = null;
    el.removeAttribute('contenteditable'); el.removeAttribute('data-qc-edit');
    var s = sel(el); { var it = item(s); var h = clean(el.innerHTML); if (it.html !== h){ snap(true); it.html = h; changed(); } }
  }
  function startEdit(el){
    if (!el || ignore(el)) return; stopEdit(); var s = sel(el);
    if (!orig[s]) orig[s] = { html: el.innerHTML, at:{} };
    editing = el; el.setAttribute('contenteditable', 'true'); el.setAttribute('data-qc-edit', '1'); el.focus();
    try { var r = document.createRange(); r.selectNodeContents(el); var g = getSelection(); g.removeAllRanges(); g.addRange(r); } catch(e){}
  }
  function bindEdit(){
    var css = document.createElement('style'); css.id = 'qc-live-ui';
    css.textContent = '[data-qc-hov]{outline:1px dashed #3b9cff !important;outline-offset:-1px}' +
      '[data-qc-sel]{outline:2px solid #ff4d00 !important;outline-offset:-2px;cursor:default}' +
      '[data-qc-edit]{outline:2px solid #00c27a !important;cursor:text !important;user-select:text !important;-webkit-user-select:text !important}' +
      '#news-modal,#nl-popup,#sub-modal,#alert-modal,#ref-modal,#dotd-modal{display:none !important}' +
      '*{animation-play-state:paused !important}';
    document.head.appendChild(css);
    function target(e){ var t = e.target; if (t && t.nodeType === 3) t = t.parentElement; return ignore(t) ? null : t; }
    window.addEventListener('mouseover', function(e){ var t = target(e); if (hovEl) hovEl.removeAttribute('data-qc-hov'); hovEl = t; if (t && t !== selEl) t.setAttribute('data-qc-hov', '1'); }, true);
    window.addEventListener('click', function(e){
      if (editing && editing.contains(e.target)) return;            // caret placement inside text being edited
      var t = target(e); e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (!t) return; stopEdit();
      if (t === selEl && info(t).text && !t.querySelector('*:not(br):not(b):not(i):not(em):not(strong):not(span)')) startEdit(t); else select(t);
    }, true);
    ['submit','mousedown','touchstart','keydown'].forEach(function(ev){
      window.addEventListener(ev, function(e){
        if (ev === 'keydown'){ if (editing){ if (e.key === 'Escape'){ stopEdit(); } e.stopPropagation(); } return; }
        if (ev === 'submit' || (editing && editing.contains(e.target))) { if (ev === 'submit') e.preventDefault(); return; }
        if (ev === 'mousedown' && e.target.closest && e.target.closest('input,select,textarea,button')) e.preventDefault();
      }, true);
    });
    document.addEventListener('input', function(e){ if (editing && editing.contains(e.target)){ var it = item(sel(editing)); snap(); it.html = clean(editing.innerHTML); dirty = true; emit('change'); try{ localStorage.setItem('qc_draft_' + ns(), JSON.stringify(pack())); }catch(_){} } });
    document.addEventListener('paste', function(e){ if (editing){ e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); } });
    document.addEventListener('dblclick', function(e){ var t = target(e); if (t){ e.preventDefault(); select(t); if (info(t).text) startEdit(t); } }, true);
    window.addEventListener('scroll', function(){}, { passive:true });
    emit('ready');
  }

  /* ---------- public API ---------- */
  var API = {
    edit: EDIT,
    load: function(cb){
      fetch(url()).then(function(r){ return r.ok ? r.json() : null; }).then(function(raw){
        data = unpack(raw);
        if (EDIT){ try { var d = localStorage.getItem('qc_draft_' + ns()); if (d){ var dd = JSON.parse(d); if (!raw || (dd.updated || 0) > (raw.updated || 0)) { API.draft = dd; } } } catch(e){} }
        render(); cb && cb();
      }).catch(function(){ render(); cb && cb(); });
    },
    restoreDraft: function(){ if (API.draft){ snap(true); data = unpack(API.draft); API.draft = null; changed(); } },
    discardDraft: function(){ API.draft = null; try { localStorage.removeItem('qc_draft_' + ns()); } catch(e){} },
    selected: function(){ return selEl ? sel(selEl) : null; },
    setStyle: function(prop, val){ if (!selEl) return; var it = item(sel(selEl)); snap(); if (val === '' || val == null) delete it.st[prop]; else it.st[prop] = val; changed(); emit('select', { info: info(selEl), keep:1 }); },
    setAttr: function(name, val){ if (!selEl) return; var el = selEl; if (name === 'href'){ el = selEl.closest('a') || selEl; }
      var s = sel(el), it = item(s); snap(true); if (!orig[s]) orig[s] = { at:{} }; if (!(name in (orig[s].at||{}))) { orig[s].at = orig[s].at || {}; orig[s].at[name] = el.getAttribute(name); }
      it.at[name] = val; changed(); emit('select', { info: info(selEl), keep:1 }); },
    editText: function(){ if (selEl) startEdit(selEl); },
    stopEdit: stopEdit,
    toggleHide: function(){ if (!selEl) return; var it = item(sel(selEl)); snap(true); it.hide = !it.hide; changed(); emit('select', { info: info(selEl), keep:1 }); },
    resetSelected: function(){ if (!selEl) return; var s = sel(selEl), prev = clone(data); snap(true); delete data.items[s]; revertGone(prev); changed(); emit('select', { info: info(selEl), keep:1 }); },
    parent: function(){ if (selEl && selEl.parentElement && !ignore(selEl.parentElement)){ stopEdit(); select(selEl.parentElement); selEl.scrollIntoView({ block:'nearest' }); } },
    child: function(){ if (selEl && selEl.firstElementChild){ stopEdit(); select(selEl.firstElementChild); } },
    sibling: function(dir){ if (!selEl) return; var n = dir > 0 ? selEl.nextElementSibling : selEl.previousElementSibling; if (n && !ignore(n)){ stopEdit(); select(n); n.scrollIntoView({ block:'nearest' }); } },
    setVar: function(k, v){ snap(); if (v) data.vars[k] = v; else delete data.vars[k]; changed(); },
    setFont: function(kind, name){ snap(true); if (name) data.fonts[kind] = name; else delete data.fonts[kind]; changed(); },
    setCSS: function(c){ snap(); data.css = c; changed(); },
    getVars: function(){ return clone(data.vars); }, getFonts: function(){ return clone(data.fonts); }, getCSS: function(){ return data.css || ''; },
    sectionStyle: function(selector, prop, v){ snap(); var it = item(selector); if (v) it.st[prop] = v; else delete it.st[prop]; changed(); },
    undo: function(){ stopEdit(); if (!hist.length) return; var prev = clone(data); fut.push(prev); data = hist.pop(); revertGone(prev); dirty = true; render(); emit('change'); select(null); },
    redo: function(){ stopEdit(); if (!fut.length) return; var prev = clone(data); hist.push(prev); data = fut.pop(); revertGone(prev); dirty = true; render(); emit('change'); select(null); },
    resetAll: function(){ stopEdit(); var prev = clone(data); snap(true); data = { vars:{}, fonts:{}, css:'', items:{} }; revertGone(prev); changed(); select(null); },
    showView: function(id){ ['home-view','stores-view','deals-view'].forEach(function(v){ var e = document.getElementById(v); if (e) e.style.display = (v === id ? '' : 'none'); }); scrollTo(0, 0); select(null); },
    save: function(){
      stopEdit();
      return fetch(url(), { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(pack()) })
        .then(function(r){ if (!r.ok) throw new Error('save failed'); dirty = false; try { localStorage.removeItem('qc_draft_' + ns()); } catch(e){} emit('saved'); return true; });
    },
    isDirty: function(){ return dirty; }
  };
  window.QCLive = API;

  function boot(){ API.load(function(){ if (EDIT) bindEdit(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
