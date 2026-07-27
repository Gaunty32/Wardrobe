import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, Phone, Clock } from 'lucide-react';
import { useSubmitShopEnquiry } from '@workspace/api-client-react';

export default function ContactUs() {
  const submitEnquiry = useSubmitShopEnquiry();
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', message: '' });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitEnquiry.mutate({ data: formData }, {
      onSuccess: () => {
        alert('Message sent successfully!');
        setFormData({ name: '', email: '', phone: '', message: '' });
      },
      onError: () => {
        alert('Failed to send message. Please try again.');
      }
    });
  };

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-48 bg-primary flex items-center justify-center">
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase">
          Contact Us
        </h1>
      </section>

      <section className="py-16 container mx-auto px-4 max-w-6xl">
        <div className="flex flex-col md:flex-row gap-16">
          
          {/* Contact Info */}
          <div className="w-full md:w-1/2 space-y-8">
            <h2 className="text-2xl font-bold text-gray-900 border-b-2 border-primary pb-4 inline-block">Get In Touch</h2>
            
            <div className="space-y-6 text-gray-700">
              <div className="flex items-start gap-4">
                <MapPin className="w-6 h-6 text-accent shrink-0 mt-1" />
                <div>
                  <h4 className="font-bold text-gray-900">Address</h4>
                  <p>Select Branding Solutions<br/>3rd Floor, Albion Mills Business Centre<br/>Albion Mills, Apperley Bridge<br/>BD10 9TQ</p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <Phone className="w-6 h-6 text-accent shrink-0 mt-1" />
                <div>
                  <h4 className="font-bold text-gray-900">Phone</h4>
                  <p>0113 255 2694</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <Clock className="w-6 h-6 text-accent shrink-0 mt-1" />
                <div>
                  <h4 className="font-bold text-gray-900">Opening Hours</h4>
                  <p>Monday to Friday<br/>9.30am to 4:00pm</p>
                </div>
              </div>
            </div>

            <div className="pt-8">
              <img 
                src="https://www.selectuniforms.co.uk/wp-content/uploads/Uniforms-showroom.jpg" 
                alt="Our Showroom" 
                className="w-full h-64 object-cover border-4 border-gray-100 shadow-sm"
              />
            </div>
          </div>

          {/* Form */}
          <div className="w-full md:w-1/2 bg-gray-50 p-8 border border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">SEND US AN EMAIL</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Your Name *</label>
                <Input name="name" value={formData.name} onChange={handleChange} required className="rounded-none bg-white" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Your Email *</label>
                <Input type="email" name="email" value={formData.email} onChange={handleChange} required className="rounded-none bg-white" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Phone Number</label>
                <Input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="rounded-none bg-white" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Your Message *</label>
                <Textarea 
                  name="message" 
                  value={formData.message} 
                  onChange={handleChange} 
                  required 
                  className="rounded-none bg-white min-h-[150px]" 
                />
              </div>
              <Button 
                type="submit" 
                size="lg" 
                className="w-full rounded-none font-bold tracking-widest mt-4"
                disabled={submitEnquiry.isPending}
              >
                {submitEnquiry.isPending ? 'SENDING...' : 'SEND MESSAGE'}
              </Button>
            </form>
          </div>

        </div>
      </section>
    </div>
  );
}
