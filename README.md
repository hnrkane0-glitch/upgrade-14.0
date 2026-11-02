# QuickCart — deploy guide

1. Upload this whole folder to Vercel (or `vercel --prod`). No build step.
2. **Card terminal (one-time):** Vercel → Project → Settings → Environment Variables →
   add `PAYSTACK_SECRET_KEY` = your `sk_live_…` key, then redeploy.
3. In the POS → ⚙ Settings, paste your **Paystack Terminal ID** and press **Test**.
   Also fill in the bank-transfer account and any OPay/Kuda/Moniepoint/PalmPay accounts.
4. POS card options: Paystack terminal (amount is pushed to the device), external card machine
   (record the approval code), or online Paystack checkout.

Notes
- Customers visiting `…/store?store=<owner>` see only the shop — no login/admin/subscribe/editor links.
- Staff never see the Page Editor (hidden in the dashboard, blocked in the router and in page-editor.html).
- Stock is deducted with Firebase atomic increments, so POS and online sales can't overwrite each other.
- Stock Count: start (all/one category, optional blind count) → scan/type quantities → Finalize applies only the differences.
