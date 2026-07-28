---
name: Customer PATCH schema gap
description: UpdateCustomerBody generated schema was missing customer fields; how to avoid silent-drop in future
---

# Customer PATCH schema gap

## Rule
`UpdateCustomerBody` in `lib/api-zod/src/generated/api.ts` is generated from an OpenAPI spec that did not include all editable customer fields. The PATCH route uses `.safeParse()` on this schema, so any unrecognised field is silently dropped before the DB write.

**Why:** The OpenAPI spec was hand-authored and fell behind the actual Drizzle schema in `lib/db/src/schema/customers.ts`. Fields added to the DB after the spec was written (logoUrl, defaultShippingService, highLevelContactId, poNumberRequired, requiresPrepayment, zeroVat, hasReviewed, billingEmail, invoiceName/Address/City/Postcode) were never reflected in the generated Zod schema.

**How to apply:** Whenever a new column is added to `customers.ts`, also add the corresponding field to `UpdateCustomerBody` in `lib/api-zod/src/generated/api.ts` (lines ~88-99) AND `lib/api-zod/src/generated/types/updateCustomerBody.ts`. The same pattern likely applies to other generated entity schemas (suppliers, products, etc.).
