/*
 * Wix Velo backend — paste into your site's  backend/events.js
 * Keeps the "Licenses" collection in sync with Wix Pricing Plans subscriptions:
 * issues a key on purchase, marks it inactive on cancel/expire.
 *
 * ⚠️ VERIFY BEFORE RELYING ON IT:
 *  - Event handler names + payload shapes differ by Pricing Plans API version
 *    (v1 vs v2). Check dev.wix.com Pricing Plans "Events" for your version and
 *    adjust the export names / field paths (order id, plan id, buyer, dates).
 *  - Emailing the key: simplest is a Wix Automation ("Pricing plan purchased" ->
 *    send email). To include the generated key in that email, either store it
 *    (done here) and reference it, or send via wix-crm-backend triggeredEmails
 *    from this handler. Wire whichever your setup supports.
 *  - Math.random() keys are fine for a soft license gate; swap for wix-crypto if
 *    you want stronger keys.
 */
import wixData from 'wix-data';

function genKey() {
  const r = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GMLF-${r()}-${r()}-${r()}`;
}

// Fired when a member buys/orders a pricing plan. (Verify exact name for your API version.)
export async function wixPricingPlans_onOrderPurchased(event) {
  const order = (event && event.order) || event || {};
  const buyer = order.buyer || {};
  await wixData.insert('Licenses', {
    key: genKey(),
    status: 'ACTIVE',
    orderId: order._id || order.orderId || null,
    planId: order.planId || null,
    memberId: buyer.memberId || null,
    email: buyer.email || null,
    expiresAt: order.endDate || null, // null = until canceled (open-ended subscription)
    createdAt: new Date(),
  }, { suppressAuth: true });
  // TODO: email the key to buyer.email (Automation or triggeredEmails).
}

async function setStatusByOrder(orderId, status) {
  if (!orderId) return;
  const res = await wixData.query('Licenses').eq('orderId', orderId).find({ suppressAuth: true });
  for (const lic of res.items) {
    lic.status = status;
    await wixData.update('Licenses', lic, { suppressAuth: true });
  }
}

export async function wixPricingPlans_onOrderCanceled(event) {
  const order = (event && event.order) || event || {};
  await setStatusByOrder(order._id || order.orderId, 'CANCELED');
}

// Optional: handle expiry/auto-renew-cancel similarly if your API exposes them.
export async function wixPricingPlans_onOrderEnded(event) {
  const order = (event && event.order) || event || {};
  await setStatusByOrder(order._id || order.orderId, 'EXPIRED');
}
