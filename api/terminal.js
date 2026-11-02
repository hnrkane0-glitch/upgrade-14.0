/* QuickCart — Paystack Terminal bridge (Vercel serverless function)
   Keeps your Paystack SECRET key on the server. Set it in:
   Vercel → Project → Settings → Environment Variables → PAYSTACK_SECRET_KEY  (sk_live_…)
   Actions (POST JSON {action, ...}):
     presence {terminalId}                         → is the terminal online?
     push     {terminalId, amount, reference, email?, description?}
                                                   → creates a payment request and pushes it to the terminal
     status   {requestCode, terminalId?, eventId?} → has the customer paid / did the terminal receive it?
     verify   {reference, amount}                  → verifies an online (popup) card payment            */
const PS = 'https://api.paystack.co';

async function ps(path, method, body) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) { const e = new Error('Card terminal is not set up on the server yet (PAYSTACK_SECRET_KEY missing).'); e.code = 'NO_KEY'; throw e; }
  const r = await fetch(PS + path, {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) { const e = new Error(j.message || ('Paystack error ' + r.status)); e.code = 'PS'; throw e; }
  return j.data;
}
const okId  = (s) => /^[A-Za-z0-9_-]{3,60}$/.test(String(s || ''));
const okRef = (s) => /^[A-Za-z0-9._=-]{3,80}$/.test(String(s || ''));
const okMail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

async function customerCode(email) {
  try { const c = await ps('/customer/' + encodeURIComponent(email)); if (c && c.customer_code) return c.customer_code; } catch (e) { if (e.code === 'NO_KEY') throw e; }
  const c = await ps('/customer', 'POST', { email, first_name: 'POS', last_name: 'Customer' });
  return c.customer_code;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  try {
    if (b.action === 'presence') {
      if (!okId(b.terminalId)) return res.status(400).json({ error: 'Invalid terminal ID' });
      const d = await ps('/terminal/' + b.terminalId + '/presence');
      return res.json({ online: !!(d && d.online), available: !!(d && d.available) });
    }
    if (b.action === 'push') {
      const amount = Math.round(Number(b.amount));
      if (!okId(b.terminalId)) return res.status(400).json({ error: 'Invalid terminal ID' });
      if (!(amount > 0) || amount > 50000000) return res.status(400).json({ error: 'Invalid amount' });
      if (!okRef(b.reference)) return res.status(400).json({ error: 'Invalid reference' });
      const email = okMail(b.email) ? String(b.email) : 'pos@quickcart.ng';
      const customer = await customerCode(email);
      const pr = await ps('/paymentrequest', 'POST', {
        customer, amount: amount * 100, currency: 'NGN',
        description: String(b.description || 'POS sale ' + b.reference).slice(0, 120),
        send_notification: false, draft: false
      });
      const ev = await ps('/terminal/' + b.terminalId + '/event', 'POST', {
        type: 'invoice', action: 'process', data: { id: pr.id, reference: pr.offline_reference }
      });
      return res.json({ requestCode: pr.request_code, invoiceId: pr.id, offlineReference: pr.offline_reference, eventId: ev && ev.id });
    }
    if (b.action === 'status') {
      if (!/^[A-Za-z0-9_-]{3,60}$/.test(String(b.requestCode || ''))) return res.status(400).json({ error: 'Invalid request code' });
      const d = await ps('/paymentrequest/verify/' + b.requestCode);
      const st = String((d && d.status) || '').toLowerCase();
      const paid = !!(d && (d.paid === true || d.paid_at || st === 'success' || st === 'paid'));
      let delivered = null;
      if (b.eventId && okId(b.terminalId) && /^[A-Za-z0-9_-]{3,60}$/.test(String(b.eventId))) {
        try { const ev = await ps('/terminal/' + b.terminalId + '/event/' + b.eventId); delivered = !!(ev && ev.delivered); } catch (e) {}
      }
      return res.json({ paid, status: st, delivered });
    }
    if (b.action === 'verify') {
      if (!okRef(b.reference)) return res.status(400).json({ error: 'Invalid reference' });
      const d = await ps('/transaction/verify/' + encodeURIComponent(b.reference));
      const paid = !!d && d.status === 'success' && (!b.amount || Number(d.amount) >= Math.round(Number(b.amount)) * 100);
      return res.json({ paid, status: d && d.status, channel: d && d.channel });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(e.code === 'NO_KEY' ? 503 : 502).json({ error: e.message || 'Server error', code: e.code || 'ERR' });
  }
};
