import { useState } from "react";

const NAVY = "#1a2335";

const CATS = [
  { name: "Hospitality", count: 67, img: "https://picsum.photos/seed/chef400/600/450" },
  { name: "Sportswear",  count: 60, img: "https://picsum.photos/seed/sport22/600/450" },
  { name: "Hi-Vis",      count: 59, img: "https://picsum.photos/seed/safety9/600/450" },
  { name: "Businesswear",count: 48, img: "https://picsum.photos/seed/suit400/600/450" },
];

/* keyframes injected once */
const css = `
@keyframes slashIn  { from { clip-path: polygon(0 100%, 0 100%, 20% 100%, 20% 100%); }
                      to   { clip-path: polygon(0 30%,  0 100%, 100% 100%, 100% 55%); } }
@keyframes slashOut { from { clip-path: polygon(0 30%,  0 100%, 100% 100%, 100% 55%); }
                      to   { clip-path: polygon(0 100%, 0 100%, 20% 100%, 20% 100%); } }
`;

if (typeof document !== "undefined") {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

function Tile({ cat, forceHover }: { cat: typeof CATS[0]; forceHover?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const on = hovered || !!forceHover;

  return (
    <div
      className="relative overflow-hidden cursor-pointer"
      style={{ aspectRatio: "4/3", background: "#f3f4f6" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Product image — desaturates on hover */}
      <img
        src={cat.img}
        alt={cat.name}
        className="absolute inset-0 w-full h-full object-cover transition-all duration-500"
        style={{
          transform: on ? "scale(1.05)" : "scale(1)",
          filter: on ? "grayscale(60%) brightness(0.75)" : "grayscale(0%) brightness(1)",
        }}
      />

      {/* Permanent bottom gradient */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 55%)",
          opacity: on ? 0 : 1,
        }}
      />

      {/* Diagonal navy slash — clip-path animated */}
      <div
        className="absolute inset-0 flex items-end pb-5 pl-4"
        style={{
          background: NAVY,
          clipPath: on
            ? "polygon(0 30%, 0 100%, 100% 100%, 100% 55%)"
            : "polygon(0 100%, 0 100%, 20% 100%, 20% 100%)",
          transition: on
            ? "clip-path 0.45s cubic-bezier(0.22,1,0.36,1)"
            : "clip-path 0.35s cubic-bezier(0.55,0,1,0.45)",
        }}
      >
        <div>
          <p
            className="text-white font-extrabold uppercase tracking-widest leading-tight"
            style={{
              fontSize: "clamp(0.9rem, 2.3vw, 1.3rem)",
              opacity: on ? 1 : 0,
              transform: on ? "translateX(0)" : "translateX(-10px)",
              transition: "opacity 0.3s 0.15s, transform 0.3s 0.15s",
            }}
          >
            {cat.name}
          </p>
          <p
            className="text-white/60 text-xs tracking-wide mt-0.5"
            style={{
              opacity: on ? 1 : 0,
              transform: on ? "translateX(0)" : "translateX(-6px)",
              transition: "opacity 0.3s 0.22s, transform 0.3s 0.22s",
            }}
          >
            {cat.count} products
          </p>
        </div>
      </div>

      {/* Circle arrow — top-right on hover */}
      <div
        className="absolute top-3 right-3 flex items-center justify-center rounded-full border-2 border-white text-white font-bold"
        style={{
          width: 32, height: 32, fontSize: 14,
          opacity: on ? 1 : 0,
          transform: on ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(-45deg)",
          transition: "opacity 0.3s 0.2s, transform 0.35s 0.15s",
          background: "rgba(255,255,255,0.15)",
          backdropFilter: "blur(4px)",
        }}
      >
        →
      </div>

      {/* Default label */}
      <div
        className="absolute bottom-0 left-0 right-0 px-3 pb-3 transition-all duration-300"
        style={{ opacity: on ? 0 : 1 }}
      >
        <p className="text-white font-semibold text-sm uppercase tracking-wide drop-shadow">{cat.name}</p>
        <p className="text-white/70 text-xs drop-shadow">{cat.count} products</p>
      </div>
    </div>
  );
}

export function DiagonalFlash() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", padding: 32 }}>
      <p style={{ fontSize: 11, color: "#888", letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>
        C — Diagonal Flash · hover any tile
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 840 }}>
        {CATS.map((cat, i) => (
          <Tile key={cat.name} cat={cat} forceHover={i === 3} />
        ))}
      </div>
    </div>
  );
}
