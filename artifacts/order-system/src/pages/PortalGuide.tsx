import { ShoppingBag, Shirt, Package, Users, Truck, FileText, ArrowRight, LogIn, CheckCircle2 } from "lucide-react";

const PORTAL_URL = "/customer-portal";

const SHOTS = [
  "/demo-bg/portal.jpg",
  "/demo-bg/wardrobe.png",
  "/demo-bg/orders.jpg",
  "/demo-bg/dashboard.jpg",
];

const COLUMNS: { imgs: string[]; duration: number }[] = [
  { imgs: [SHOTS[0], SHOTS[2], SHOTS[3], SHOTS[1]], duration: 30 },
  { imgs: [SHOTS[1], SHOTS[3], SHOTS[0], SHOTS[2]], duration: 24 },
  { imgs: [SHOTS[2], SHOTS[0], SHOTS[1], SHOTS[3]], duration: 27 },
];

function ScrollColumn({ imgs, duration }: { imgs: string[]; duration: number }) {
  const doubled = [...imgs, ...imgs];
  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        className="demo-scroll-col flex flex-col gap-3"
        style={{ animationDuration: `${duration}s` }}
      >
        {doubled.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            className="w-full rounded-xl shadow-lg border border-white/10 select-none"
          />
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: Shirt,
    colour: "bg-violet-500/20 text-violet-400",
    title: "Your branded wardrobe",
    body: "Browse only the products set up for your company — already branded, embroidered, or printed exactly as agreed with Select Branding Solutions.",
  },
  {
    icon: ShoppingBag,
    colour: "bg-blue-500/20 text-blue-400",
    title: "Self-service ordering",
    body: "Choose your items, pick your sizes, and submit orders directly. No emails back and forth — everything goes straight into our production system.",
  },
  {
    icon: Users,
    colour: "bg-emerald-500/20 text-emerald-400",
    title: "Order for yourself or your team",
    body: "Place an order for stock, assign items to named team members, or let each person order their own — it's flexible to suit how your business works.",
  },
  {
    icon: Truck,
    colour: "bg-amber-500/20 text-amber-400",
    title: "Track your deliveries",
    body: "See the status of every order from submitted through to dispatched. DPD tracking numbers appear automatically once your order ships.",
  },
  {
    icon: Package,
    colour: "bg-sky-500/20 text-sky-400",
    title: "Order history",
    body: "Every order you've ever placed is saved and searchable. Reorder from previous orders, check what you had last time, or download invoices.",
  },
  {
    icon: FileText,
    colour: "bg-rose-500/20 text-rose-400",
    title: "Invoices on demand",
    body: "Download PDF invoices for any completed order directly from the portal — no need to contact us.",
  },
];

const STEPS = [
  {
    step: "1",
    title: "Check your inbox",
    body: "You'll receive an invitation email from Select Branding Solutions with a link to activate your account.",
  },
  {
    step: "2",
    title: "Set your password",
    body: "Click the link, set a password for your account, and you're in. Takes less than a minute.",
  },
  {
    step: "3",
    title: "Browse and order",
    body: "Your wardrobe is ready and waiting. Browse your products, pick your sizes, and place your first order.",
  },
];

export default function PortalGuide() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const portalHref = base + PORTAL_URL;

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="relative flex flex-col md:flex-row min-h-[92vh] overflow-hidden">

        {/* Left: copy */}
        <div className="relative z-10 flex flex-col justify-center w-full md:w-[480px] shrink-0 px-8 py-16 md:py-20 bg-slate-950">

          {/* Brand */}
          <div className="mb-10">
            <div className="inline-flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Shirt className="w-5 h-5 text-blue-400" />
              </div>
              <span className="text-lg font-bold tracking-tight">Select Branding Solutions</span>
            </div>
            <p className="text-slate-500 text-sm">Uniform ordering, made simple</p>
          </div>

          <h1 className="text-3xl md:text-4xl font-extrabold leading-tight mb-4">
            Your company's<br />
            <span className="text-blue-400">uniform portal</span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-sm">
            Browse your branded wardrobe, place orders for yourself or your team, and track deliveries — all in one place. No phone calls, no emails, no hassle.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href={portalHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors px-6 py-3 text-sm font-semibold text-white shadow-lg"
            >
              <LogIn className="w-4 h-4" /> Sign in to the portal
            </a>
            <a
              href="mailto:chris@selectbranding.co.uk?subject=Portal account query"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 hover:border-slate-500 hover:bg-slate-900 transition-colors px-6 py-3 text-sm font-semibold text-slate-300"
            >
              Need help? Contact us
            </a>
          </div>

          <p className="mt-8 text-slate-600 text-xs leading-relaxed">
            No account yet? You'll receive an invitation email from Select Branding Solutions when your portal is ready.
          </p>
        </div>

        {/* Right: scrolling mosaic */}
        <div className="hidden md:flex flex-1 overflow-hidden relative gap-3 p-4 bg-slate-900">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-900 to-transparent z-10" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900 to-transparent z-10" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-slate-900 to-transparent z-10" />
          {COLUMNS.map((col, i) => (
            <ScrollColumn key={i} imgs={col.imgs} duration={col.duration} />
          ))}
        </div>
      </div>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border-t border-slate-800">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-center mb-2">Everything you need, nothing you don't</h2>
          <p className="text-slate-400 text-sm text-center mb-10 max-w-xl mx-auto">
            The portal is built specifically for ordering branded workwear and uniforms. It's simple, fast, and works on any device.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="rounded-xl bg-slate-800/60 border border-slate-700/60 p-5">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${f.colour}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="font-semibold text-sm mb-1.5">{f.title}</p>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-center mb-2">Getting started</h2>
        <p className="text-slate-400 text-sm text-center mb-10 max-w-xl mx-auto">
          Setting up your account takes less than two minutes.
        </p>
        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map((s) => (
            <div key={s.step} className="flex flex-col items-start">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-base mb-4 shrink-0">
                {s.step}
              </div>
              <p className="font-semibold text-sm mb-1.5">{s.title}</p>
              <p className="text-xs text-slate-400 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>

        {/* Bullet reassurances */}
        <div className="mt-12 rounded-2xl bg-slate-900 border border-slate-800 px-6 py-6">
          <p className="text-sm font-semibold mb-4 text-slate-300">A few things worth knowing</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              "Works on desktop, tablet, and mobile",
              "Secure login — your data is only visible to your team",
              "Orders go straight into production — no manual steps",
              "Tracking numbers appear automatically when your order ships",
              "Download invoices and order history any time",
              "Need changes? Contact us directly from the portal",
            ].map((point) => (
              <div key={point} className="flex items-start gap-2.5 text-sm text-slate-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                {point}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA footer ───────────────────────────────────────────────────────── */}
      <div className="bg-slate-900 border-t border-slate-800">
        <div className="max-w-3xl mx-auto px-6 py-12 text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to place your first order?</h2>
          <p className="text-slate-400 text-sm mb-7 max-w-md mx-auto">
            Sign in to your portal and your branded wardrobe will be waiting for you. If you haven't received your invitation yet, get in touch and we'll sort it.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={portalHref}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors px-8 py-3 text-sm font-semibold text-white shadow-lg"
            >
              <LogIn className="w-4 h-4" /> Sign in to the portal <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="mailto:chris@selectbranding.co.uk?subject=I haven't received my portal invitation"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-colors px-8 py-3 text-sm font-semibold text-slate-300"
            >
              Haven't received your invite?
            </a>
          </div>
          <p className="mt-8 text-slate-600 text-xs">
            Select Branding Solutions · <a href="https://selectbranding.co.uk" className="hover:text-slate-400 transition-colors">selectbranding.co.uk</a> · <a href="mailto:chris@selectbranding.co.uk" className="hover:text-slate-400 transition-colors">chris@selectbranding.co.uk</a>
          </p>
        </div>
      </div>
    </div>
  );
}
