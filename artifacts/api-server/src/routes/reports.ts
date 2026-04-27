import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ─── Portal pending orders report ────────────────────────────────────────────
// Returns customers that have portal orders not yet confirmed by SBS,
// grouped by customer with summary counts, total value, and per-order detail.

router.get("/reports/portal-pending", async (req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.customer_name,
      o.status,
      o.portal_status,
      o.total_amount,
      o.order_date,
      o.created_at,
      o.required_date,
      o.portal_submitted_by_name,
      o.portal_submitted_by_email,
      o.notes,
      o.portal_notes,
      c.email       AS customer_email,
      c.phone       AS customer_phone,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.source = 'portal'
      AND o.portal_status NOT IN ('confirmed', 'rejected')
    ORDER BY o.created_at ASC
  `);

  // Group by customer
  const byCustomer: Record<string, {
    customerId: number;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    orders: any[];
    totalValue: number;
    oldestOrderDate: string;
  }> = {};

  for (const row of rows.rows as any[]) {
    const key = String(row.customer_id ?? row.customer_name);
    if (!byCustomer[key]) {
      byCustomer[key] = {
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerEmail: row.customer_email ?? null,
        customerPhone: row.customer_phone ?? null,
        orders: [],
        totalValue: 0,
        oldestOrderDate: row.order_date ?? row.created_at,
      };
    }
    byCustomer[key].orders.push({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      portalStatus: row.portal_status,
      totalAmount: parseFloat(row.total_amount ?? "0"),
      orderDate: row.order_date,
      createdAt: row.created_at,
      requiredDate: row.required_date,
      submittedByName: row.portal_submitted_by_name,
      submittedByEmail: row.portal_submitted_by_email,
      itemCount: parseInt(row.item_count ?? "0"),
      notes: row.portal_notes || row.notes || null,
    });
    byCustomer[key].totalValue += parseFloat(row.total_amount ?? "0");
    // keep the oldest date
    const rowDate = row.order_date ?? row.created_at;
    if (rowDate < byCustomer[key].oldestOrderDate) {
      byCustomer[key].oldestOrderDate = rowDate;
    }
  }

  const result = Object.values(byCustomer).sort(
    (a, b) => new Date(a.oldestOrderDate).getTime() - new Date(b.oldestOrderDate).getTime()
  );

  res.json({ customers: result, totalOrders: rows.rows.length });
});

export default router;
