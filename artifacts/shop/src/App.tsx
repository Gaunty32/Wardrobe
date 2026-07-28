import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { CartProvider } from '@/context/CartContext';
import { Layout } from '@/components/Layout';
import ChatWidget from '@/components/ChatWidget';

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
import KnowledgeCentre from '@/pages/KnowledgeCentre';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/products" component={Shop} />
        <Route path="/category/:slug" component={CategoryPage} />
        <Route path="/product/:slug" component={ProductDetail} />
        <Route path="/cart" component={Cart} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/order-complete" component={OrderComplete} />
        <Route path="/about" component={AboutUs} />
        <Route path="/contact" component={ContactUs} />
        <Route path="/faq" component={FAQ} />
        <Route path="/bulk-buy-bundles" component={BulkBuyBundles} />
        <Route path="/reviews" component={Reviews} />
        <Route path="/knowledge-centre" component={KnowledgeCentre} />
        <Route path="/latest-news">{() => <Redirect to="/knowledge-centre" />}</Route>
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
            <ChatWidget />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </CartProvider>
    </QueryClientProvider>
  );
}

export default App;
