import { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { useCart } from '@/context/CartContext';
import { useShopAuth, getShopToken } from '@/context/ShopAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Lazily load stripe promise outside component
let stripePromise: Promise<any> | null = null;
const getStripePromise = () => {
  if (!stripePromise) {
    stripePromise = fetch(`/api/stripe/publishable-key`)
      .then(r => r.json())
      .then(d => loadStripe(d.publishableKey));
  }
  return stripePromise;
};

function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [, setLocation] = useLocation();
  const { items, subtotal, clearCart } = useCart();
  const { customer, isLoggedIn } = useShopAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const shipping = 8.50;
  const vat = subtotal * 0.20;
  const total = subtotal + vat + shipping;

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    company: '',
    email: '',
    phone: '',
    address1: '',
    address2: '',
    city: '',
    postcode: '',
  });

  // Pre-fill from account when logged in
  useEffect(() => {
    if (customer) {
      setFormData(prev => ({
        ...prev,
        firstName: customer.first_name  ?? prev.firstName,
        lastName:  customer.last_name   ?? prev.lastName,
        company:   customer.company     ?? prev.company,
        phone:     customer.phone       ?? prev.phone,
        address1:  customer.address_1   ?? prev.address1,
        address2:  customer.address_2   ?? prev.address2,
        city:      customer.city        ?? prev.city,
        postcode:  customer.postcode    ?? prev.postcode,
        email:     customer.email       ?? prev.email,
      }));
    }
  }, [customer]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    if (!formData.firstName || !formData.lastName || !formData.email || !formData.address1 || !formData.city || !formData.postcode) {
      alert('Please fill in all required fields');
      return;
    }

    setIsProcessing(true);
    
    try {
      // 1. Create Payment Intent
      const piRes = await fetch(`/api/shop/stripe/payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: total, cartItems: items })
      });
      if (!piRes.ok) throw new Error('Failed to create payment intent');
      const { clientSecret } = await piRes.json();

      // 2. Confirm Card Payment
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: `${formData.firstName} ${formData.lastName}`,
            email: formData.email,
            phone: formData.phone,
            address: {
              line1: formData.address1,
              line2: formData.address2,
              city: formData.city,
              postal_code: formData.postcode,
              country: 'GB'
            }
          }
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        // 3. Create Order — send in the format the backend ShopOrderSchema expects
        const token = getShopToken();
        const orderRes = await fetch(`/api/shop/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            paymentIntentId: paymentIntent.id,
            customerName: `${formData.firstName} ${formData.lastName}`.trim(),
            customerEmail: formData.email,
            customerPhone: formData.phone || null,
            company: formData.company || null,
            deliveryAddress: {
              line1: formData.address1,
              line2: formData.address2 || null,
              city: formData.city,
              postcode: formData.postcode,
              country: 'GB',
            },
            cartItems: items,
            subtotal,
            carriage: shipping,
            total,
            shopCustomerId: customer?.id ?? null,
          })
        });
        if (!orderRes.ok) throw new Error('Failed to create order in database');
        const order = await orderRes.json();

        // 4. Success → redirect
        clearCart();
        setLocation(`/order-complete?orderId=${order.id}`);
      }

    } catch (err: any) {
      alert(`Payment failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col lg:flex-row gap-12">
      {/* Left: Billing Details */}
      <div className="w-full lg:w-3/5">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-primary">BILLING DETAILS</h2>
          {isLoggedIn ? (
            <span className="text-sm text-green-600 font-semibold">
              ✓ Signed in — details pre-filled
            </span>
          ) : (
            <Link href="/login" className="text-sm text-primary underline hover:no-underline">
              Sign in to pre-fill
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">First Name *</label>
            <Input name="firstName" value={formData.firstName} onChange={handleChange} required className="rounded-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Last Name *</label>
            <Input name="lastName" value={formData.lastName} onChange={handleChange} required className="rounded-none" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Company name (optional)</label>
          <Input name="company" value={formData.company} onChange={handleChange} className="rounded-none" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Email address *</label>
            <Input type="email" name="email" value={formData.email} onChange={handleChange} required className="rounded-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Phone</label>
            <Input name="phone" value={formData.phone} onChange={handleChange} className="rounded-none" />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-bold text-gray-700 mb-1">Street address *</label>
          <Input name="address1" placeholder="House number and street name" value={formData.address1} onChange={handleChange} required className="rounded-none mb-2" />
          <Input name="address2" placeholder="Apartment, suite, unit etc. (optional)" value={formData.address2} onChange={handleChange} className="rounded-none" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Town / City *</label>
            <Input name="city" value={formData.city} onChange={handleChange} required className="rounded-none" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Postcode *</label>
            <Input name="postcode" value={formData.postcode} onChange={handleChange} required className="rounded-none" />
          </div>
        </div>
      </div>

      {/* Right: Your Order */}
      <div className="w-full lg:w-2/5">
        <div className="border-4 border-primary p-6 bg-gray-50">
          <h2 className="text-xl font-bold mb-6 text-primary">YOUR ORDER</h2>
          
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="py-2 text-left text-gray-600">Product</th>
                <th className="py-2 text-right text-gray-600">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-200">
                  <td className="py-3 text-gray-700">{item.name} <strong className="text-gray-900">× {item.quantity}</strong></td>
                  <td className="py-3 text-right font-bold text-gray-900">£{(item.price * item.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300">
              <tr>
                <td className="py-3 font-bold text-gray-900">Subtotal</td>
                <td className="py-3 text-right font-bold text-gray-900">£{subtotal.toFixed(2)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 font-bold text-gray-900">Shipping</td>
                <td className="py-3 text-right text-gray-700">Flat rate: £{shipping.toFixed(2)}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-3 font-bold text-gray-900">VAT</td>
                <td className="py-3 text-right text-gray-700">£{vat.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="py-4 font-bold text-lg text-primary">Total</td>
                <td className="py-4 text-right font-bold text-lg text-primary">£{total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mb-6 p-4 bg-white border border-gray-300">
            <label className="block text-sm font-bold text-gray-700 mb-2">Credit Card (Stripe)</label>
            <div className="p-3 border border-gray-300 rounded-sm">
              <CardElement options={{ style: { base: { fontSize: '16px' } } }} />
            </div>
            <p className="text-xs text-gray-500 mt-2">Pay securely using your credit or debit card.</p>
          </div>

          <Button 
            type="submit" 
            size="lg" 
            className="w-full rounded-none font-bold text-lg h-14"
            disabled={!stripe || isProcessing}
          >
            {isProcessing ? 'PROCESSING...' : 'PLACE ORDER'}
          </Button>
        </div>
      </div>
    </form>
  );
}

export default function Checkout() {
  const { items } = useCart();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (items.length === 0) {
      setLocation('/cart');
    }
  }, [items, setLocation]);

  if (items.length === 0) return null;

  return (
    <div className="container mx-auto px-4 py-12">
      {/* 3-step Breadcrumb */}
      <div className="flex items-center justify-center gap-4 mb-16 text-sm sm:text-base md:text-xl font-bold">
        <span className="text-gray-400">① BASKET</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-900">② CHECKOUT DETAILS</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">③ ORDER COMPLETE</span>
      </div>

      <Elements stripe={getStripePromise()}>
        <CheckoutForm />
      </Elements>
    </div>
  );
}
