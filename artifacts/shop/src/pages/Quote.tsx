import { useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { CheckCircle } from 'lucide-react';
import { useSubmitShopEnquiry } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export default function Quote() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState('');

  const submitEnquiry = useSubmitShopEnquiry();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    submitEnquiry.mutate(
      { 
        data: {
          name: formData.name,
          email: formData.email,
          company: formData.company || undefined,
          phone: formData.phone || undefined,
          message: formData.message,
        }
      },
      {
        onSuccess: (response) => {
          setReferenceNumber(response.referenceNumber);
          setSubmitted(true);
          setFormData({ name: '', email: '', company: '', phone: '', message: '' });
        },
        onError: () => {
          toast({
            title: 'Error',
            description: 'Failed to submit enquiry. Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 container mx-auto px-4 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-6">
              <CheckCircle className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-bold mb-4">Quote Request Received</h1>
            <p className="text-lg text-muted-foreground mb-2">
              Thank you for your enquiry. We'll get back to you shortly.
            </p>
            <p className="text-sm text-muted-foreground mb-8">
              Your reference number: <span className="font-mono font-semibold">{referenceNumber}</span>
            </p>
            <Button onClick={() => setSubmitted(false)} data-testid="button-submit-another">
              Submit Another Enquiry
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1">
        <div className="bg-muted/30 border-b py-8">
          <div className="container mx-auto px-4">
            <h1 className="text-3xl font-bold mb-4">Request a Quote</h1>
            <p className="text-muted-foreground">
              Fill out the form below and we'll provide you with a detailed quote for your requirements
            </p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-12">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Enquiry Form</CardTitle>
                <CardDescription>
                  Please provide your details and requirements. We'll respond within 24 hours.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">
                        Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        data-testid="input-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">
                        Email <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        data-testid="input-email"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="company">Company</Label>
                      <Input
                        id="company"
                        value={formData.company}
                        onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                        data-testid="input-company"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        data-testid="input-phone"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message">
                      Message <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="message"
                      required
                      rows={6}
                      placeholder="Tell us about your requirements: quantities, products, branding needs, timeline, etc."
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      data-testid="input-message"
                    />
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full" 
                    size="lg"
                    disabled={submitEnquiry.isPending}
                    data-testid="button-submit-quote"
                  >
                    {submitEnquiry.isPending ? 'Submitting...' : 'Submit Enquiry'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
