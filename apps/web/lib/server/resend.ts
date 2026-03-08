type SendResendEmailInput = {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string | null;
};

type SendResendEmailResult = {
  id: string;
};

function normalizeToList(to: string | string[]) {
  if (Array.isArray(to)) return to;
  return [to];
}

export function isResendApiKeyConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function getResendApiKey() {
  return (process.env.RESEND_API_KEY || '').trim();
}

export async function sendResendEmail(input: SendResendEmailInput): Promise<SendResendEmailResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error('missing_resend_api_key');

  const from = input.from.trim();
  if (!from) throw new Error('missing_resend_from');

  const to = normalizeToList(input.to).map((value) => String(value || '').trim()).filter(Boolean);
  if (!to.length) throw new Error('missing_resend_to');

  const subject = String(input.subject || '').trim();
  if (!subject) throw new Error('missing_resend_subject');

  const payload: Record<string, unknown> = {
    from,
    to,
    subject
  };
  if (input.text) payload.text = input.text;
  if (input.html) payload.html = input.html;
  if (input.replyTo) payload.reply_to = input.replyTo;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : `resend_error_${response.status}`;
      throw new Error(message);
    }

    const id = typeof data?.id === 'string' ? data.id : '';
    if (!id) throw new Error('resend_missing_message_id');
    return { id };
  } finally {
    clearTimeout(timeoutId);
  }
}

