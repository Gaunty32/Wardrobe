import { useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Phone, Mail, MapPin, CheckCircle } from 'lucide-react';
import { useGetShopSettings, useSubmitShopEnquiry } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export default function Contact() {
  const { data: settings } = useGetShopSettings();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

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
        onSuccess: () => {
          setSubmitted(true);
          setFormData({ name: '', email: '', company: '', phone: '', message: '' });
          setTimeout(() => setSubmitted(false), 5000);
        },
        onError: () => {
          toast({
            title: 'Error',
            description: 'Failed to send message. Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1">
        <div className="bg-muted/30 border-b py-8">
          <div className="container mx-auto px-4">
            <h1 className="text-3xl font-bold mb-4">Contact Us</h1>
            <p className="text-muted-foreground">Get in touch with our team</p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Contact Information */}
            <div>
              <h2 className="text-2xl font-bold mb-6">Get in Touch</h2>
              <div className="space-y-6 mb-8">
                {settings?.contactPhone && (
                  <div className="flex items-start gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary flex-shrink-0">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Phone</h3>
                      <p className="text-muted-foreground">{settings.contactPhone}</p>
                    </div>
                  </div>
                )}

                {settings?.contactEmail && (
                  <div className="flex items-start gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary flex-shrink-0">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Email</h3>
                      <p className="text-muted-foreground">{settings.contactEmail}</p>
                    </div>
                  </div>
                )}

                {settings?.address && (
                  <div className="flex items-start gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary flex-shrink-0">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Address</h3>
                      <p className="text-muted-foreground">{settings.address}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Map placeholder */}
              <div className="aspect-video bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
                <MapPin className="h-8 w-8" />
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Send us a message</CardTitle>
                </CardHeader>
                <CardContent>
                  {submitted ? (
                    <div className="text-center py-8">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-4">
                        <CheckCircle className="h-6 w-6" />
                      </div>
                      <h3 className="font-semibold mb-2">Message sent!</h3>
                      <p className="text-sm text-muted-foreground">
                        We'll get back to you shortly.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="contact-name">
                          Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="contact-name"
                          required
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          data-testid="input-contact-name"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contact-email">
                          Email <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="contact-email"
                          type="email"
                          required
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          data-testid="input-contact-email"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contact-company">Company</Label>
                        <Input
                          id="contact-company"
                          value={formData.company}
                          onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                          data-testid="input-contact-company"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contact-phone">Phone</Label>
                        <Input
                          id="contact-phone"
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          data-testid="input-contact-phone"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="contact-message">
                          Message <span className="text-destructive">*</span>
                        </Label>
                        <Textarea
                          id="contact-message"
                          required
                          rows={4}
                          value={formData.message}
                          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                          data-testid="input-contact-message"
                        />
                      </div>

                      <Button 
                        type="submit" 
                        className="w-full"
                        disabled={submitEnquiry.isPending}
                        data-testid="button-submit-contact"
                      >
                        {submitEnquiry.isPending ? 'Sending...' : 'Send Message'}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
