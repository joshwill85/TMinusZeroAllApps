import { permanentRedirect } from 'next/navigation';

export default function SmsTermsPage() {
  permanentRedirect('/docs/sms-opt-in');
}
