import Layout from "@/components/Layout";
import { useGetDashboardStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Link } from "wouter";
import { DollarSign, ShoppingCart, Users, Package, ArrowRight, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetDashboardStats();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
            <p className="font-medium animate-pulse">Loading dashboard metrics...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!stats) return null;

  const chartData = [
    { name: 'Draft', value: stats.ordersByStatus.draft, color: '#94a3b8' },
    { name: 'Confirmed', value: stats.ordersByStatus.confirmed, color: '#3b82f6' },
    { name: 'Shipped', value: stats.ordersByStatus.shipped, color: '#f59e0b' },
    { name: 'Delivered', value: stats.ordersByStatus.delivered, color: '#10b981' },
    { name: 'Cancelled', value: stats.ordersByStatus.cancelled, color: '#ef4444' },
  ].filter(item => item.value > 0);

  return (
    <Layout>
      <div className="flex flex-col space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">Here's what's happening with your business today.</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {formatCurrency(stats.totalRevenue)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-indigo-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalOrders}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Customers</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalCustomers}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Products</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Package className="w-5 h-5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalProducts}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart */}
          <Card className="col-span-1 shadow-sm border-border/50 flex flex-col">
            <CardHeader>
              <CardTitle className="font-display">Orders by Status</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-[300px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: number) => [`${value} Orders`, 'Count']}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No order data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Orders */}
          <Card className="col-span-1 lg:col-span-2 shadow-sm border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display">Recent Orders</CardTitle>
              <Link href="/orders" className="text-sm font-medium text-primary flex items-center hover:underline">
                View all <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </CardHeader>
            <CardContent>
              {stats.recentOrders.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border/50">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="font-medium text-foreground">Order</TableHead>
                        <TableHead className="font-medium text-foreground">Customer</TableHead>
                        <TableHead className="font-medium text-foreground">Date</TableHead>
                        <TableHead className="font-medium text-foreground">Status</TableHead>
                        <TableHead className="text-right font-medium text-foreground">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.recentOrders.map((order) => (
                        <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell>
                            <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium text-foreground">{order.customerName || 'Unknown'}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(order.orderDate)}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className="text-right font-bold text-foreground">
                            {formatCurrency(order.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
                  <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="font-medium text-foreground">No orders yet</p>
                  <p className="text-sm mt-1 mb-4">Create your first sales order to see it here.</p>
                  <Link href="/orders" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                    Create Order
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
