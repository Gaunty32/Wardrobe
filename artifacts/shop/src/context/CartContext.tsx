import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface BrandingPosition {
  id: string;
  name: string;
  surcharge: number;
}

export interface CartItem {
  wcProductId: number;
  variationId?: number | null;
  name: string;
  sku?: string | null;
  price: number;
  quantity: number;
  image?: string | null;
  colour?: string | null;
  size?: string | null;
  brandingPositions?: BrandingPosition[];
  wearerName?: string | null;
}


interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (index: number) => void;
  updateQuantity: (index: number, qty: number) => void;
  updateWearerName: (index: number, name: string) => void;
  repriceProduct: (wcProductId: number, newUnitPrice: number) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const stored = localStorage.getItem('sbs_cart');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('sbs_cart', JSON.stringify(items));
  }, [items]);

  const addItem = (item: CartItem) => {
    setItems((prev) => {
      // Match on product + variation + colour + size + branding + wearer name
      const posKey = (positions: BrandingPosition[] | undefined) =>
        JSON.stringify((positions ?? []).map((p) => p.id).sort());
      const normalName = (n: string | null | undefined) => (n ?? '').trim().toLowerCase();
      const existingIdx = prev.findIndex(
        (i) =>
          i.wcProductId === item.wcProductId &&
          i.variationId === item.variationId &&
          i.colour === item.colour &&
          i.size === item.size &&
          posKey(i.brandingPositions) === posKey(item.brandingPositions) &&
          normalName(i.wearerName) === normalName(item.wearerName)
      );

      if (existingIdx >= 0) {
        const newItems = [...prev];
        newItems[existingIdx] = {
          ...newItems[existingIdx],
          quantity: newItems[existingIdx].quantity + item.quantity,
          price: item.price, // update price (tier may have changed)
        };
        return newItems;
      }
      return [...prev, item];
    });
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, qty: number) => {
    if (qty < 1) return;
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index].quantity = qty;
      return newItems;
    });
  };

  const updateWearerName = (index: number, name: string) => {
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], wearerName: name };
      return newItems;
    });
  };

  const repriceProduct = (wcProductId: number, newUnitPrice: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.wcProductId === wcProductId ? { ...item, price: newUnitPrice } : item
      )
    );
  };

  const clearCart = () => setItems([]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => {
    const brandingSurcharge = i.brandingPositions?.reduce((s, p) => s + p.surcharge, 0) ?? 0;
    return sum + (i.price + brandingSurcharge) * i.quantity;
  }, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        updateWearerName,
        repriceProduct,
        clearCart,
        itemCount,
        subtotal,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
