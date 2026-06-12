/**
 * DPD Local API v3.2 integration
 * Spec: api.dpdlocal.co.uk
 *
 * Required env vars:
 *   DPD_USERNAME        – DPD account username
 *   DPD_PASSWORD        – DPD account password (plain text — encoded as base64 per spec)
 *   DPD_ACCOUNT_NUMBER  – DPD account number (used in GeoClient header)
 *
 * Optional env vars:
 *   DPD_SENDER_NAME     – Business name shown on labels (e.g. "Select Branding Solutions")
 *   DPD_SENDER_LINE1    – Collection address street
 *   DPD_SENDER_TOWN     – Collection town / city
 *   DPD_SENDER_POSTCODE – Collection postcode
 *   DPD_NETWORK_CODE    – Service network code (default: "2^12" = Parcel Next Day)
 */

const DPD_BASE = "https://api.dpdlocal.co.uk";

function getConfig() {
  const required = [
    "DPD_USERNAME",
    "DPD_PASSWORD",
    "DPD_ACCOUNT_NUMBER",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`DPD not configured. Missing env vars: ${missing.join(", ")}`);
  }

  return {
    username: process.env.DPD_USERNAME!,
    password: process.env.DPD_PASSWORD!,
    accountNumber: process.env.DPD_ACCOUNT_NUMBER!,
    senderName: process.env.DPD_SENDER_NAME ?? "Select Branding Solutions",
    senderLine1: process.env.DPD_SENDER_LINE1 ?? "",
    senderTown: process.env.DPD_SENDER_TOWN ?? "",
    senderPostcode: process.env.DPD_SENDER_POSTCODE ?? "",
    networkCode: process.env.DPD_NETWORK_CODE ?? "2^12",
  };
}

/**
 * Authenticate with DPD Local API.
 * Per spec: base64-encode "username:password" (plain text — no hashing).
 * Returns a GeoSession token valid for the day.
 */
async function login(cfg: ReturnType<typeof getConfig>): Promise<string> {
  const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const res = await fetch(`${DPD_BASE}/user/?action=login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      GeoClient: `account/${cfg.accountNumber}`,
    },
  });

  if (res.status === 401) {
    throw new Error("DPD login failed: invalid username or password (HTTP 401)");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DPD login failed (${res.status}): ${body}`);
  }

  const json = await res.json() as { data?: { geoSession?: string }; error?: unknown };
  const session = json?.data?.geoSession;
  if (!session) {
    throw new Error(`DPD login succeeded but returned no geoSession. Response: ${JSON.stringify(json)}`);
  }
  return session;
}

export interface DpdDeliveryAddress {
  contactName: string;
  organisation?: string;
  line1: string;
  line2?: string;
  town: string;
  postcode: string;
  countryCode?: string;
  telephone?: string;
  email?: string;
  mobile?: string;
}

export interface BookConsignmentParams {
  orderNumber: string;
  delivery: DpdDeliveryAddress;
  numberOfParcels: number;
  totalWeightKg: number;
  collectionDate?: Date;
}

export interface ConsignmentResult {
  consignmentNumber: string;
  shipmentId: number;
  trackingUrl: string;
  labelHtml: string | null;
}

export async function bookDpdConsignment(params: BookConsignmentParams): Promise<ConsignmentResult> {
  const cfg = getConfig();
  const geoSession = await login(cfg);

  const authHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
    GeoClient: `account/${cfg.accountNumber}`,
    GeoSession: geoSession,
  };

  const collectionDate = (params.collectionDate ?? new Date()).toISOString().split("T")[0] + "T09:00:00";

  const shipmentPayload = {
    jobId: null,
    collectionOnDelivery: false,
    invoice: null,
    collectionDate,
    consolidate: false,
    consignment: [
      {
        consignmentNumber: null,
        consignmentRef: params.orderNumber,
        parcel: [],
        collectionDetails: {
          contactDetails: {
            contactName: cfg.senderName,
            telephone: "",
          },
          address: {
            organisation: cfg.senderName,
            countryCode: "GB",
            postcode: cfg.senderPostcode,
            street: cfg.senderLine1,
            locality: "",
            town: cfg.senderTown,
            county: "",
          },
        },
        deliveryDetails: {
          contactDetails: {
            contactName: params.delivery.contactName,
            telephone: params.delivery.telephone ?? "",
          },
          address: {
            organisation: params.delivery.organisation ?? params.delivery.contactName,
            countryCode: params.delivery.countryCode ?? "GB",
            postcode: params.delivery.postcode,
            street: params.delivery.line1,
            locality: params.delivery.line2 ?? "",
            town: params.delivery.town,
            county: "",
          },
          notificationDetails: {
            email: params.delivery.email ?? "",
            mobile: params.delivery.mobile ?? "",
          },
        },
        networkCode: cfg.networkCode,
        numberOfParcels: params.numberOfParcels,
        totalWeight: params.totalWeightKg,
        shippingRef1: params.orderNumber.slice(0, 25),
        shippingRef2: "",
        shippingRef3: "",
        customsValue: null,
        deliveryInstructions: "",
        parcelDescription: "",
        liabilityValue: null,
        liability: false,
      },
    ],
  };

  const shipRes = await fetch(`${DPD_BASE}/shipping/shipment`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(shipmentPayload),
  });

  if (!shipRes.ok) {
    const body = await shipRes.text();
    throw new Error(`DPD shipment booking failed (${shipRes.status}): ${body}`);
  }

  const shipJson = await shipRes.json() as {
    data?: {
      shipmentId?: number;
      consolidated?: boolean;
      consignmentDetail?: Array<{ consignmentNumber?: string; parcelNumbers?: string[] }>;
    };
    error?: { errorCode?: number; errorMessage?: string } | null;
  };

  if (shipJson.error && (shipJson.error as { errorCode?: number }).errorCode) {
    const err = shipJson.error as { errorCode?: number; errorMessage?: string };
    throw new Error(`DPD error ${err.errorCode}: ${err.errorMessage}`);
  }

  const consignmentNumber = shipJson.data?.consignmentDetail?.[0]?.consignmentNumber ?? "";
  const shipmentId = shipJson.data?.shipmentId ?? 0;

  // Fetch label HTML (non-fatal if it fails — dispatch still proceeds)
  let labelHtml: string | null = null;
  try {
    const labelRes = await fetch(
      `${DPD_BASE}/shipping/shipment/${shipmentId}/label/`,
      {
        headers: {
          ...authHeaders,
          Accept: "text/html",
        },
      }
    );
    if (labelRes.ok) {
      labelHtml = await labelRes.text();
    }
  } catch {
    // Label fetch is best-effort; dispatch still succeeds
  }

  return {
    consignmentNumber,
    shipmentId,
    trackingUrl: `https://track.dpdlocal.co.uk/search?reference=${consignmentNumber}&postcode=${encodeURIComponent(params.delivery.postcode)}`,
    labelHtml,
  };
}

export async function reprrintDpdLabel(shipmentId: number): Promise<string | null> {
  try {
    const cfg = getConfig();
    const geoSession = await login(cfg);
    const res = await fetch(`${DPD_BASE}/shipping/shipment/${shipmentId}/label/`, {
      headers: {
        GeoClient: `account/${cfg.accountNumber}`,
        GeoSession: geoSession,
        Accept: "text/html",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function isDpdConfigured(): boolean {
  return ["DPD_USERNAME", "DPD_PASSWORD", "DPD_ACCOUNT_NUMBER"].every((k) => !!process.env[k]);
}

/**
 * Test connection by attempting a login.
 * Returns detailed diagnostics to surface in Settings.
 */
export async function testDpdConnection(): Promise<{ ok: boolean; message: string; accountNumber?: string }> {
  const cfg = (() => {
    try { return getConfig(); } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();

  if ("error" in cfg) {
    return { ok: false, message: cfg.error };
  }

  try {
    await login(cfg as ReturnType<typeof getConfig>);
    return {
      ok: true,
      message: "Connected successfully to DPD Local API. GeoSession token received.",
      accountNumber: (cfg as ReturnType<typeof getConfig>).accountNumber,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
