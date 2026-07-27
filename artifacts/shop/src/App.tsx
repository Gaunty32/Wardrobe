import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { CartProvider } from '@/context/CartContext';
import { Layout } from '@/components/Layout';

// Pages (to be implemented)
import Home from '@/pages/Home';
import Shop from '@/pages/Shop';
import CategoryPage from '@/pages/CategoryPage';
import ProductDetail from '@/pages/ProductDetail';
import Cart from '@/pages/Cart';
import Checkout from '@/pages/Checkout';
import OrderComplete from '@/pages/OrderComplete';
import AboutUs from '@/pages/AboutUs';
import ContactUs from '@/pages/ContactUs';
import FAQ from '@/pages/FAQ';
import BulkBuyBundles from '@/pages/BulkBuyBundles';
import Reviews from '@/pages/Reviews';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/shop" component={Shop} />
        <Route path="/shop/category/:slug" component={CategoryPage} />
        <Route path="/shop/product/:id" component={ProductDetail} />
        <Route path="/shop/cart" component={Cart} />
        <Route path="/shop/checkout" component={Checkout} />
        <Route path="/shop/order-complete" component={OrderComplete} />
        <Route path="/shop/about" component={AboutUs} />
        <Route path="/shop/contact" component={ContactUs} />
        <Route path="/shop/faq" component={FAQ} />
        <Route path="/shop/bulk-buy-bundles" component={BulkBuyBundles} />
        <Route path="/shop/reviews" component={Reviews} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </CartProvider>
    </QueryClientProvider>
  );
}

export default App;
