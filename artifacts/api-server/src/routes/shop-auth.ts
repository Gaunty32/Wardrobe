import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { sendEmail } from "../services/email.js";

const router = Router();

const JWT_SECRET =
  process.env.SESSION_SECRET || "sbs-shop-secret-change-in-production";
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

function otpKey(email: string) {
  return `shop_otp_${email.toLowerCase().trim()}`;
}

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface ShopAuthRequest extends Request {
  shopCustomerId?: number;
  shopEmail?: string;
}

export function shopAuth(
  req: ShopAuthRequest,
  res: Response,
  next: NextFunction
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as Record<
      string,
      unknown
    >;
    if (payload.role !== "shop_customer") {
      res.status(401).json({ error: "Invalid token type" });
      return;
    }
    req.shopCustomerId = payload.sub as number;
    req.shopEmail = payload.email as string;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── POST /shop/auth/request-otp ─────────────────────────────────────────────

router.post(
  "/shop/auth/request-otp",
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body ?? {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    const normEmail = email.trim().toLowerCase();

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hash = hashCode(code);
    const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();

    // Store in settings table
    const key = otpKey(normEmail);
    await db
      .insert(settingsTable)
      .values({ key, value: JSON.stringify({ hash, expires }) })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: {
          value: JSON.stringify({ hash, expires }),
          updatedAt: new Date(),
        },
      });

    // Send email
    try {
      await sendEmail({
        to: normEmail,
        subject: "Your login code — Select Branding Solutions",
        text: `Your one-time login code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <img src="https://wardrobe.selectbranding.co.uk/wp-content/uploads/2023/08/SBS-Logo-White-BG.png"
                 alt="Select Branding Solutions" style="height:40px;margin-bottom:24px;" />
            <h2 style="color:#1e3a5f;margin:0 0 16px;">Your login code</h2>
            <p style="color:#374151;margin:0 0 24px;">
              Use the code below to sign in to your Select Branding Solutions account.
              It expires in <strong>10 minutes</strong>.
            </p>
            <div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;margin:0 0 24px;">
              <span style="font-size:36px;font-weight:700;letter-spacing:0.2em;color:#1e3a5f;">${code}</span>
            </div>
            <p style="color:#6b7280;font-size:13px;margin:0;">
              If you didn't request this code, you can safely ignore this email.
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
            <p style="color:#9ca3af;font-size:11px;margin:0;">
              Select Branding Solutions Ltd &middot; wardrobe.selectbranding.co.uk
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error("[shop-auth] Failed to send OTP email:", err);
      res.status(502).json({ error: "Failed to send login email. Please try again." });
      return;
    }

    res.json({ ok: true });
  }
);

// ─── POST /shop/auth/verify-otp ──────────────────────────────────────────────

router.post(
  "/shop/auth/verify-otp",
  async (req: Request, res: Response): Promise<void> => {
    const { email, code } = req.body ?? {};
    if (!email || !code) {
      res.status(400).json({ error: "Email and code required" });
      return;
    }
    const normEmail = (email as string).trim().toLowerCase();
    const key = otpKey(normEmail);

    // Fetch stored OTP
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key));
    if (!row?.value) {
      res.status(400).json({ error: "No code found for this email. Please request a new one." });
      return;
    }

    let stored: { hash: string; expires: string };
    try {
      stored = JSON.parse(row.value);
    } catch {
      res.status(400).json({ error: "Invalid stored code. Please request a new one." });
      return;
    }

    if (new Date(stored.expires) < new Date()) {
      await db.delete(settingsTable).where(eq(settingsTable.key, key));
      res.status(400).json({ error: "Code has expired. Please request a new one." });
      return;
    }

    if (hashCode(String(code).trim()) !== stored.hash) {
      res.status(400).json({ error: "Incorrect code. Please check and try again." });
      return;
    }

    // Consume the OTP
    await db.delete(settingsTable).where(eq(settingsTable.key, key));

    // Find or create shop customer
    const existing = await db.execute(
      sql`SELECT id, email, first_name, last_name, company, phone,
                 address_1, address_2, city, county, postcode, country
          FROM shop_customers WHERE email = ${normEmail} LIMIT 1`
    );

    let customer: Record<string, unknown>;
    if ((existing.rows as any[]).length > 0) {
      customer = existing.rows[0] as Record<string, unknown>;
    } else {
      const inserted = await db.execute(
        sql`INSERT INTO shop_customers (email, created_at, updated_at)
            VALUES (${normEmail}, now(), now())
            RETURNING id, email, first_name, last_name, company, phone,
                      address_1, address_2, city, county, postcode, country`
      );
      customer = inserted.rows[0] as Record<string, unknown>;
    }

    const token = jwt.sign(
      { role: "shop_customer", sub: (customer as any).id, email: normEmail },
      JWT_SECRET,
      { expiresIn: "90d" }
    );

    res.json({ token, customer });
  }
);

// ─── GET /shop/auth/me ────────────────────────────────────────────────────────

router.get(
  "/shop/auth/me",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const result = await db.execute(
      sql`SELECT id, email, first_name, last_name, company, phone,
                 address_1, address_2, city, county, postcode, country,
                 created_at
          FROM shop_customers WHERE id = ${req.shopCustomerId} LIMIT 1`
    );
    if (!(result.rows as any[]).length) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json({ customer: result.rows[0] });
  }
);

// ─── PATCH /shop/customer/profile ────────────────────────────────────────────

router.patch(
  "/shop/customer/profile",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const {
      firstName, lastName, company, phone,
      address1, address2, city, county, postcode,
    } = req.body ?? {};

    await db.execute(sql`
      UPDATE shop_customers SET
        first_name = COALESCE(${firstName ?? null}, first_name),
        last_name  = COALESCE(${lastName  ?? null}, last_name),
        company    = COALESCE(${company   ?? null}, company),
        phone      = COALESCE(${phone     ?? null}, phone),
        address_1  = COALESCE(${address1  ?? null}, address_1),
        address_2  = COALESCE(${address2  ?? null}, address_2),
        city       = COALESCE(${city      ?? null}, city),
        county     = COALESCE(${county    ?? null}, county),
        postcode   = COALESCE(${postcode  ?? null}, postcode),
        updated_at = now()
      WHERE id = ${req.shopCustomerId}
    `);

    const result = await db.execute(
      sql`SELECT id, email, first_name, last_name, company, phone,
                 address_1, address_2, city, county, postcode, country
          FROM shop_customers WHERE id = ${req.shopCustomerId} LIMIT 1`
    );
    res.json({ customer: result.rows[0] });
  }
);

// ─── GET /shop/customer/orders ────────────────────────────────────────────────

router.get(
  "/shop/customer/orders",
  shopAuth,
  async (req: ShopAuthRequest, res: Response): Promise<void> => {
    const orders = await db.execute(sql`
      SELECT o.id, o.order_number, o.status, o.total_amount, o.carriage_amount,
             o.order_date, o.notes
      FROM orders o
      WHERE o.shop_customer_id = ${req.shopCustomerId}
      ORDER BY o.order_date DESC
      LIMIT 50
    `);

    // Fetch items for each order
    const orderIds = (orders.rows as any[]).map((o) => o.id);
    let items: any[] = [];
    if (orderIds.length) {
      const itemsResult = await db.execute(sql`
        SELECT order_id, product_name, quantity, unit_price, line_total, colour, size
        FROM order_items
        WHERE order_id = ANY(${orderIds as any})
        ORDER BY id
      `);
      items = itemsResult.rows as any[];
    }

    const itemsByOrder = items.reduce<Record<number, any[]>>((acc, item) => {
      if (!acc[item.order_id]) acc[item.order_id] = [];
      acc[item.order_id].push(item);
      return acc;
    }, {});

    res.json({
      orders: (orders.rows as any[]).map((o) => ({
        ...o,
        items: itemsByOrder[o.id] ?? [],
      })),
    });
  }
);

export default router;
