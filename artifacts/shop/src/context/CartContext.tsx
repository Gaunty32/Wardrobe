import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (index: number) => void;
  updateQuantity: (index: number, qty: number) => void;
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
      // Find if same product and variation already exists
      const existingIdx = prev.findIndex(
        (i) =>
          i.wcProductId === item.wcProductId &&
          i.variationId === item.variationId &&
          i.colour === item.colour &&
          i.size === item.size
      );

      if (existingIdx >= 0) {
        const newItems = [...prev];
        newItems[existingIdx].quantity += item.quantity;
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

  const clearCart = () => setItems([]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
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
