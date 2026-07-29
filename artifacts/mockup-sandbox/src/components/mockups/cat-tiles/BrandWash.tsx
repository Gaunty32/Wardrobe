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
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out"
        style={{ transform: on ? "scale(1.08)" : "scale(1)" }}
      />

      {/* Permanent dark footer so name is always readable */}
      <div
        className="absolute inset-0 transition-opacity duration-400"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.1) 45%, transparent 70%)",
          opacity: on ? 0 : 1,
        }}
      />

      {/* Brand-wash overlay — slides up from bottom on hover */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ease-out"
        style={{
          background: NAVY,
          opacity: on ? 0.93 : 0,
          transform: on ? "translateY(0)" : "translateY(6%)",
        }}
      >
        <span
          className="text-white font-extrabold tracking-widest uppercase text-center px-4 transition-all duration-500"
          style={{ fontSize: "clamp(1.1rem, 3vw, 1.6rem)", transform: on ? "translateY(0)" : "translateY(12px)", opacity: on ? 1 : 0 }}
        >
          {cat.name}
        </span>
        {/* Animated underline */}
        <div
          className="mt-2 bg-white transition-all duration-500"
          style={{ height: 2, width: on ? 60 : 0, transitionDelay: on ? "100ms" : "0ms" }}
        />
        <span
          className="mt-4 text-white/75 text-xs tracking-widest uppercase transition-all duration-500"
          style={{ opacity: on ? 1 : 0, transform: on ? "translateY(0)" : "translateY(8px)", transitionDelay: on ? "160ms" : "0ms" }}
        >
          Explore Collection →
        </span>
      </div>

      {/* Default label — fades out on hover */}
      <div
        className="absolute bottom-0 left-0 right-0 px-3 pb-3 transition-opacity duration-300"
        style={{ opacity: on ? 0 : 1 }}
      >
        <p className="text-white font-semibold text-sm uppercase tracking-wide drop-shadow">{cat.name}</p>
        <p className="text-white/70 text-xs drop-shadow">{cat.count} products</p>
      </div>
    </div>
  );
}

export function BrandWash() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", padding: 32 }}>
      <p style={{ fontSize: 11, color: "#888", letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>
        A — Brand Wash · hover any tile
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 840 }}>
        {CATS.map((cat, i) => (
          <Tile key={cat.name} cat={cat} forceHover={i === 1} />
        ))}
      </div>
    </div>
  );
}
