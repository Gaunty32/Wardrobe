import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { CartProvider } from '@/context/CartContext';
import { ShopAuthProvider } from '@/context/ShopAuthContext';
import { Layout } from '@/components/Layout';
import ChatWidget from '@/components/ChatWidget';

// Lazy-loaded pages — each becomes its own JS chunk, reducing initial bundle
const Home             = lazy(() => import('@/pages/Home'));
const Shop             = lazy(() => import('@/pages/Shop'));
const CategoryPage     = lazy(() => import('@/pages/CategoryPage'));
const ProductDetail    = lazy(() => import('@/pages/ProductDetail'));
const Cart             = lazy(() => import('@/pages/Cart'));
const Checkout         = lazy(() => import('@/pages/Checkout'));
const OrderComplete    = lazy(() => import('@/pages/OrderComplete'));
const AboutUs          = lazy(() => import('@/pages/AboutUs'));
const ContactUs        = lazy(() => import('@/pages/ContactUs'));
const FAQ              = lazy(() => import('@/pages/FAQ'));
const BulkBuyBundles   = lazy(() => import('@/pages/BulkBuyBundles'));
const Reviews          = lazy(() => import('@/pages/Reviews'));
const KnowledgeCentre  = lazy(() => import('@/pages/KnowledgeCentre'));
const Login            = lazy(() => import('@/pages/Login'));
const Account          = lazy(() => import('@/pages/Account'));
const Personalisation  = lazy(() => import('@/pages/Personalisation'));
const OnSiteMeasuring  = lazy(() => import('@/pages/OnSiteMeasuring'));
const UniformManagement = lazy(() => import('@/pages/UniformManagement'));
const LogoConversions  = lazy(() => import('@/pages/LogoConversions'));
const NotFound         = lazy(() => import('@/pages/not-found'));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
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
          <Route path="/login" component={Login} />
          <Route path="/account" component={Account} />
          <Route path="/personalisation" component={Personalisation} />
          <Route path="/on-site-measuring" component={OnSiteMeasuring} />
          <Route path="/uniform-management" component={UniformManagement} />
          <Route path="/logo-conversions" component={LogoConversions} />
          <Route path="/latest-news">{() => <Redirect to="/knowledge-centre" />}</Route>
          {/* Legacy redirects — strip old /shop prefix from any URL */}
          <Route path="/shop/product/:slug">{(p: any) => <Redirect to={`/product/${p.slug}`} />}</Route>
          <Route path="/shop/category/:slug">{(p: any) => <Redirect to={`/category/${p.slug}`} />}</Route>
          <Route path="/shop/cart">{() => <Redirect to="/cart" />}</Route>
          <Route path="/shop/checkout">{() => <Redirect to="/checkout" />}</Route>
          <Route path="/shop/knowledge-centre">{() => <Redirect to="/knowledge-centre" />}</Route>
          <Route path="/shop">{() => <Redirect to="/products" />}</Route>
          <Route path="/shop/:rest*">{(p: any) => <Redirect to={`/${p.rest ?? ''}`} />}</Route>
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ShopAuthProvider>
        <CartProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
              <ChatWidget />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </CartProvider>
      </ShopAuthProvider>
    </QueryClientProvider>
  );
}

export default App;
