import { permanentRedirect } from 'next/navigation';

export default function SmsTermsPage() {
  permanentRedirect('/legal/terms#sms-alerts');
}

