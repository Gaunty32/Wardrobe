import { Router, type IRouter } from "express";
import { db, customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient, getStripePublishableKey } from "../services/stripeClient.js";

const router: IRouter = Router();

async function ensureStripeCustomer(customerId: number) {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) throw new Error("Customer not found");

  const stripe = await getUncachableStripeClient();

  if (customer.stripeCustomerId) {
    try {
      const stripeCustomer = await stripe.customers.retrieve(customer.stripeCustomerId);
      if (!("deleted" in stripeCustomer)) return stripeCustomer;
    } catch {
    }
  }

  const stripeCustomer = await stripe.customers.create({
    name: customer.name,
    email: customer.email || undefined,
    phone: customer.phone || undefined,
    metadata: { sbs_customer_id: String(customerId) },
  });

  await db
    .update(customersTable)
    .set({ stripeCustomerId: stripeCustomer.id })
    .where(eq(customersTable.id, customerId));

  return stripeCustomer;
}

router.get("/stripe/publishable-key", async (req, res): Promise<void> => {
  try {
    const key = await getStripePublishableKey();
    res.json({ publishableKey: key });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/stripe/customers/:id/payment-methods", async (req, res): Promise<void> => {
  const customerId = parseInt(req.params.id);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  try {
    const stripeCustomer = await ensureStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const methods = await stripe.paymentMethods.list({
      customer: stripeCustomer.id,
      type: "card",
    });
    res.json({ paymentMethods: methods.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/stripe/customers/:id/setup-intent", async (req, res): Promise<void> => {
  const customerId = parseInt(req.params.id);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  try {
    const stripeCustomer = await ensureStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomer.id,
      payment_method_types: ["card"],
    });
    res.json({ clientSecret: setupIntent.client_secret });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/stripe/customers/:id/payment-methods/:pmId", async (req, res): Promise<void> => {
  const customerId = parseInt(req.params.id);
  const pmId = req.params.pmId;
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  try {
    const stripeCustomer = await ensureStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== stripeCustomer.id) {
      res.status(403).json({ error: "Payment method does not belong to this customer" });
      return;
    }
    await stripe.paymentMethods.detach(pmId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/stripe/customers/:id/charge", async (req, res): Promise<void> => {
  const customerId = parseInt(req.params.id);
  if (isNaN(customerId)) { res.status(400).json({ error: "Invalid customer ID" }); return; }
  const { paymentMethodId, amount, currency = "gbp", description } = req.body;
  if (!paymentMethodId || !amount) {
    res.status(400).json({ error: "paymentMethodId and amount are required" });
    return;
  }
  try {
    const stripeCustomer = await ensureStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      customer: stripeCustomer.id,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: description || `Order payment — SBS`,
    });
    res.json({ success: true, paymentIntentId: intent.id, status: intent.status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
