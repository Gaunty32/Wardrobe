import { useState } from "react";

const NAVY = "#1a2335";

const CATS = [
  { name: "Hospitality", count: 67, img: "https://picsum.photos/seed/chef400/600/450" },
  { name: "Sportswear",  count: 60, img: "https://picsum.photos/seed/sport22/600/450" },
  { name: "Hi-Vis",      count: 59, img: "https://picsum.photos/seed/safety9/600/450" },
  { name: "Businesswear",count: 48, img: "https://picsum.photos/seed/suit400/600/450" },
];

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
      {/* Product image */}
      <img
        src={cat.img}
        alt={cat.name}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-600 ease-out"
        style={{ transform: on ? "scale(1.06)" : "scale(1)" }}
      />

      {/* Always-present light bottom gradient */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }}
      />

      {/* Default name (slides down & fades out on hover) */}
      <div
        className="absolute bottom-0 left-0 right-0 px-4 pb-3 transition-all duration-400 ease-out"
        style={{ transform: on ? "translateY(8px)" : "translateY(0)", opacity: on ? 0 : 1 }}
      >
        <p className="text-white font-bold text-sm uppercase tracking-widest drop-shadow">{cat.name}</p>
      </div>

      {/* Reveal panel — slides up from below the tile on hover */}
      <div
        className="absolute left-0 right-0 bottom-0 flex flex-col justify-center px-5 transition-all duration-450 ease-out"
        style={{
          background: NAVY,
          height: "46%",
          transform: on ? "translateY(0)" : "translateY(100%)",
          paddingTop: 16,
          paddingBottom: 16,
        }}
      >
        <p
          className="text-white font-extrabold uppercase tracking-widest leading-tight transition-all duration-400"
          style={{ fontSize: "clamp(0.95rem, 2.4vw, 1.35rem)", opacity: on ? 1 : 0, transitionDelay: on ? "80ms" : "0ms" }}
        >
          {cat.name}
        </p>
        <div className="flex items-center justify-between mt-2">
          <p
            className="text-white/60 text-xs tracking-wide transition-all duration-400"
            style={{ opacity: on ? 1 : 0, transitionDelay: on ? "130ms" : "0ms" }}
          >
            {cat.count} products
          </p>
          <div
            className="flex items-center justify-center rounded-full border border-white/30 transition-all duration-400"
            style={{
              width: 28, height: 28,
              opacity: on ? 1 : 0,
              transitionDelay: on ? "170ms" : "0ms",
            }}
          >
            <span className="text-white text-xs">→</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RevealPanel() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", padding: 32 }}>
      <p style={{ fontSize: 11, color: "#888", letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>
        B — Reveal Panel · hover any tile
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 840 }}>
        {CATS.map((cat, i) => (
          <Tile key={cat.name} cat={cat} forceHover={i === 2} />
        ))}
      </div>
    </div>
  );
}
