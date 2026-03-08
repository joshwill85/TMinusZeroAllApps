import { config } from 'dotenv';
import twilio from 'twilio';
import { getSiteUrl } from '@/lib/server/env';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import {
  buildSmsHelpMessage,
  buildSmsOptInConfirmationMessage,
  buildSmsStartMessage,
  buildSmsStopMessage
} from '@/lib/notifications/smsProgram';
import { SMS_HELP_KEYWORDS, SMS_START_KEYWORDS, SMS_STOP_KEYWORDS, normalizeSmsKeyword } from '@/lib/notifications/smsKeywords';

config({ path: '.env.local' });
config();

type Level = 'error' | 'warn' | 'info';

type Finding = {
  level: Level;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type Opts = {
  json: boolean;
  showPhones: boolean;
  failOnWarn: boolean;
  siteUrl: string | null;
  campaignSid: string | null;
};

function parseArgs(argv: string[]): Opts {
  const opts: Opts = { json: false, showPhones: false, failOnWarn: false, siteUrl: null, campaignSid: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--show-phones') {
      opts.showPhones = true;
      continue;
    }
    if (arg === '--fail-on-warn') {
      opts.failOnWarn = true;
      continue;
    }
    if (arg === '--site-url') {
      opts.siteUrl = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === '--campaign-sid') {
      opts.campaignSid = argv[i + 1] || null;
      i += 1;
      continue;
    }
    throw new Error(`Unknown arg: ${arg}`);
  }
  return opts;
}

function normalizeUrl(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function endsWithPath(url: string, path: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/+$/, '') === path.replace(/\/+$/, '');
  } catch {
    return normalizeUrl(url).endsWith(path.replace(/\/+$/, ''));
  }
}

function maskE164(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('+')) return trimmed;
  if (trimmed.length <= 5) return trimmed;
  return `${trimmed.slice(0, 3)}${'*'.repeat(Math.max(0, trimmed.length - 7))}${trimmed.slice(-4)}`;
}

function addFinding(findings: Finding[], level: Level, code: string, message: string, details?: Record<string, unknown>) {
  findings.push({ level, code, message, details });
}

function includesToken(haystack: string, token: string) {
  return haystack.toLowerCase().includes(token.toLowerCase());
}

function uniqLower(list: string[]) {
  const set = new Set<string>();
  list.forEach((item) => {
    const normalized = normalizeSmsKeyword(item);
    if (normalized) set.add(normalized);
  });
  return Array.from(set.values()).sort();
}

function hasHttpLink(text: string) {
  return /https?:\/\/\S+/i.test(text);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const findings: Finding[] = [];

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
  const envMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || '';
  const envFromNumber = process.env.TWILIO_FROM_NUMBER?.trim() || '';
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim() || '';

  if (!accountSid) addFinding(findings, 'error', 'missing_env', 'Missing `TWILIO_ACCOUNT_SID`.');
  if (!authToken) addFinding(findings, 'error', 'missing_env', 'Missing `TWILIO_AUTH_TOKEN`.');
  if (!envMessagingServiceSid && !envFromNumber) {
    addFinding(findings, 'error', 'missing_env', 'Missing `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM_NUMBER` for auto-discovery).');
  }
  if (!envMessagingServiceSid) {
    addFinding(
      findings,
      'info',
      'missing_messaging_service_sid',
      'Env is missing `TWILIO_MESSAGING_SERVICE_SID`. For A2P + Advanced Opt-Out, outbound SMS should be sent via the Messaging Service (not just a raw `From` number).',
      {}
    );
  }

  const siteUrl = normalizeUrl(opts.siteUrl || getSiteUrl());
  const expectedInboundUrl = `${siteUrl}/api/notifications/sms/inbound`;
  const expectedCtaProofUrl = `${siteUrl}/docs/sms-opt-in`;

  const expectedStopKeywords = uniqLower([...SMS_STOP_KEYWORDS]);
  const expectedHelpKeywords = uniqLower([...SMS_HELP_KEYWORDS]);
  const expectedStartKeywords = uniqLower([...SMS_START_KEYWORDS]);

  const codeStopMessage = buildSmsStopMessage();
  const codeStartMessage = buildSmsStartMessage();
  const codeHelpMessage = buildSmsHelpMessage();
  const codeOptInConfirmMessage = buildSmsOptInConfirmationMessage();

  const codeSendsLinks = [codeStartMessage, codeOptInConfirmMessage].some((m) => hasHttpLink(m));

  const report: Record<string, unknown> = {
    siteUrl,
    expectedInboundUrl,
    expectedCtaProofUrl,
    code: {
      brandName: BRAND_NAME,
      supportEmail: SUPPORT_EMAIL,
      stopKeywords: expectedStopKeywords,
      startKeywords: expectedStartKeywords,
      helpKeywords: expectedHelpKeywords,
      messages: {
        optInConfirmation: codeOptInConfirmMessage,
        stop: codeStopMessage,
        start: codeStartMessage,
        help: codeHelpMessage
      },
      sendsLinks: codeSendsLinks,
      optOutMode: (process.env.TWILIO_OPT_OUT_MODE || 'twilio').trim()
    },
    env: {
      hasMessagingServiceSid: Boolean(envMessagingServiceSid),
      hasFromNumber: Boolean(envFromNumber),
      verifyServiceSid: verifyServiceSid ? '<set>' : '<unset>'
    }
  };

  if (findings.some((f) => f.level === 'error')) {
    report.findings = findings;
    emit(report, opts);
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);

  const messagingServiceSid =
    envMessagingServiceSid ||
    (await discoverMessagingServiceSidByFromNumber(client, envFromNumber, findings).catch((err) => {
      addFinding(findings, 'error', 'service_discovery_failed', 'Failed to discover Messaging Service from `TWILIO_FROM_NUMBER`.', {
        error: (err as any)?.message || String(err)
      });
      return '';
    }));

  report.messagingServiceSid = messagingServiceSid || null;

  if (!messagingServiceSid) {
    report.findings = findings;
    emit(report, opts);
    process.exit(1);
  }

  const service = await client.messaging.v1.services(messagingServiceSid).fetch();
  const serviceJson = service.toJSON();
  report.messagingService = serviceJson;

  const inboundUrl = normalizeUrl(service.inboundRequestUrl);
  if (!inboundUrl) {
    addFinding(findings, 'warn', 'service_inbound_disabled', 'Messaging Service `inboundRequestUrl` is empty; inbound keyword logging may not work.', {
      messagingServiceSid
    });
  } else if (!endsWithPath(inboundUrl, '/api/notifications/sms/inbound')) {
    addFinding(findings, 'warn', 'service_inbound_mismatch', 'Messaging Service inbound webhook does not point to `/api/notifications/sms/inbound`.', {
      inboundRequestUrl: service.inboundRequestUrl,
      expectedInboundUrl
    });
  } else if (normalizeUrl(inboundUrl) !== normalizeUrl(expectedInboundUrl)) {
    addFinding(findings, 'info', 'service_inbound_diff_host', 'Messaging Service inbound webhook path matches but host differs from `--site-url`/`NEXT_PUBLIC_SITE_URL`.', {
      inboundRequestUrl: service.inboundRequestUrl,
      expectedInboundUrl
    });
  }

  if (String(service.inboundMethod || '').toUpperCase() !== 'POST') {
    addFinding(findings, 'warn', 'service_inbound_method', 'Messaging Service `inboundMethod` should be POST.', { inboundMethod: service.inboundMethod });
  }

  if (!service.usAppToPersonRegistered) {
    addFinding(findings, 'warn', 'service_not_a2p_registered', 'Messaging Service `usAppToPersonRegistered` is false. Campaign may not be fully registered/linked.', {
      messagingServiceSid
    });
  }

  const usecase = String(service.usecase || '').trim().toLowerCase();
  if (usecase && usecase !== 'notifications') {
    addFinding(findings, 'info', 'service_usecase', 'Messaging Service `usecase` is not `notifications`.', { usecase: service.usecase });
  }

  const servicePhoneNumbers = await client.messaging.v1.services(messagingServiceSid).phoneNumbers.list({ limit: 1000 });
  report.messagingServicePhoneNumbers = servicePhoneNumbers.map((row) => row.toJSON());
  const serviceSenderNumbers = servicePhoneNumbers.map((row) => String((row as any).phoneNumber || '').trim()).filter(Boolean);
  report.messagingServiceSenderNumbers = opts.showPhones ? serviceSenderNumbers : serviceSenderNumbers.map(maskE164);
  if (!servicePhoneNumbers.length) {
    addFinding(findings, 'warn', 'no_senders', 'Messaging Service has no attached phone numbers.', { messagingServiceSid });
  }
  if (envFromNumber) {
    const matchesEnvFromNumber = servicePhoneNumbers.some((row) => String(row.phoneNumber || '').trim() === envFromNumber);
    if (!matchesEnvFromNumber) {
      addFinding(
        findings,
        'warn',
        'from_number_not_in_service',
        '`TWILIO_FROM_NUMBER` is not attached to the Messaging Service. Outbound sends may not use this service/campaign.',
        { fromNumber: opts.showPhones ? envFromNumber : maskE164(envFromNumber), messagingServiceSid }
      );
    }
  }

  if (service.useInboundWebhookOnNumber) {
    addFinding(
      findings,
      'info',
      'service_number_webhooks',
      'Messaging Service is configured to use per-number inbound webhooks; auditing `smsUrl` on each number.',
      { useInboundWebhookOnNumber: service.useInboundWebhookOnNumber }
    );
    for (const row of servicePhoneNumbers) {
      const sid = row.sid;
      try {
        const phone = await client.incomingPhoneNumbers(sid).fetch();
        const smsUrl = normalizeUrl(phone.smsUrl);
        if (!smsUrl) {
          addFinding(findings, 'warn', 'number_sms_url_missing', 'Incoming phone number `smsUrl` is empty.', {
            sid,
            phoneNumber: opts.showPhones ? phone.phoneNumber : maskE164(phone.phoneNumber)
          });
          continue;
        }
        if (!endsWithPath(smsUrl, '/api/notifications/sms/inbound')) {
          addFinding(findings, 'warn', 'number_sms_url_mismatch', 'Incoming phone number `smsUrl` does not point to `/api/notifications/sms/inbound`.', {
            sid,
            phoneNumber: opts.showPhones ? phone.phoneNumber : maskE164(phone.phoneNumber),
            smsUrl: phone.smsUrl,
            expectedInboundUrl
          });
        }
        if (String(phone.smsMethod || '').toUpperCase() !== 'POST') {
          addFinding(findings, 'warn', 'number_sms_method', 'Incoming phone number `smsMethod` should be POST.', {
            sid,
            phoneNumber: opts.showPhones ? phone.phoneNumber : maskE164(phone.phoneNumber),
            smsMethod: phone.smsMethod
          });
        }
      } catch (err: any) {
        addFinding(findings, 'warn', 'number_fetch_failed', 'Failed to fetch IncomingPhoneNumber details for a sender.', {
          sid,
          error: err?.message || String(err)
        });
      }
    }
  }

  const campaigns = await client.messaging.v1.services(messagingServiceSid).usAppToPerson.list({ limit: 20 });
  report.a2pCampaigns = campaigns.map((c) => c.toJSON());
  if (!campaigns.length) {
    addFinding(findings, 'error', 'no_campaigns', 'No A2P Campaigns found under this Messaging Service.', { messagingServiceSid });
    report.findings = findings;
    emit(report, opts);
    process.exit(1);
  }

  const selected = pickCampaign(campaigns, opts.campaignSid || process.env.TWILIO_A2P_CAMPAIGN_SID?.trim() || null);
  if (!selected) {
    addFinding(findings, 'error', 'campaign_not_found', 'Unable to select an A2P campaign; pass `--campaign-sid`.', {
      available: campaigns.map((c) => c.sid)
    });
    report.findings = findings;
    emit(report, opts);
    process.exit(1);
  }

  const campaignJson = selected.toJSON();
  report.a2pCampaignSelected = campaignJson;

  const status = String(selected.campaignStatus || '').trim().toUpperCase();
  if (status && status !== 'VERIFIED') {
    addFinding(findings, 'warn', 'campaign_not_verified', 'Campaign status is not VERIFIED.', { campaignStatus: selected.campaignStatus });
  }

  const flow = String(selected.messageFlow || '').trim();
  if (flow.length < 40) {
    addFinding(findings, 'warn', 'campaign_message_flow_short', 'Campaign messageFlow is very short; reviewers often expect detailed opt-in/out steps.', {
      length: flow.length
    });
  }
  if (flow && !includesToken(flow, 'sms-opt-in')) {
    addFinding(
      findings,
      'warn',
      'campaign_message_flow_missing_cta_proof',
      'Campaign messageFlow does not include a publicly accessible CTA proof URL (recommended when opt-in is behind login).',
      { expectedCtaProofUrl }
    );
  }
  if (flow && serviceSenderNumbers.length) {
    const flowDigits = flow.replace(/\D/g, '');
    const serviceLast10s = serviceSenderNumbers
      .map((value) => value.replace(/\D/g, ''))
      .map((digits) => (digits.length >= 10 ? digits.slice(-10) : ''))
      .filter(Boolean);

    const hasAnyNumber = serviceLast10s.some((last10) => flowDigits.includes(last10));
    if (!hasAnyNumber) {
      addFinding(
        findings,
        'warn',
        'campaign_message_flow_missing_numbers',
        'Campaign messageFlow does not appear to include any originating phone number(s). Reviewers often expect you to list the 10DLC number(s) messages will originate from.',
        { numbers: opts.showPhones ? serviceSenderNumbers : serviceSenderNumbers.map(maskE164) }
      );
    }
  }
  if (flow && !includesToken(flow, 'stop')) {
    addFinding(findings, 'warn', 'campaign_message_flow_missing_stop', 'Campaign messageFlow does not mention STOP.', {});
  }
  if (flow && !includesToken(flow, 'help')) {
    addFinding(findings, 'warn', 'campaign_message_flow_missing_help', 'Campaign messageFlow does not mention HELP.', {});
  }

  const samples = Array.isArray(selected.messageSamples) ? selected.messageSamples : [];
  if (samples.length < 2 || samples.length > 5) {
    addFinding(findings, 'warn', 'campaign_message_samples_count', 'Campaign messageSamples should have 2–5 examples.', { count: samples.length });
  }

  const sampleHasBrand = samples.some((s) => includesToken(String(s), BRAND_NAME));
  if (!sampleHasBrand) {
    addFinding(findings, 'warn', 'campaign_samples_missing_brand', 'Campaign messageSamples do not include the brand name.', {});
  }

  if (codeSendsLinks && !selected.hasEmbeddedLinks) {
    addFinding(
      findings,
      'error',
      'campaign_links_mismatch',
      'Our code sends at least one message containing an https:// link, but the Campaign is not marked `hasEmbeddedLinks`.',
      { hasEmbeddedLinks: selected.hasEmbeddedLinks }
    );
  }

  const subscriberOptIn = (selected as any).subscriberOptIn;
  if (subscriberOptIn !== true) {
    addFinding(
      findings,
      'warn',
      'campaign_subscriber_opt_in',
      'Campaign `subscriberOptIn` is not true (false/undefined). Reviewers typically expect subscriber opt-in enabled for consent-based alerts.',
      { subscriberOptIn: subscriberOptIn ?? null }
    );
  }

  const twilioOptOutKeywords = uniqLower(selected.optOutKeywords || []);
  const twilioHelpKeywords = uniqLower(selected.helpKeywords || []);
  const twilioOptInKeywords = uniqLower(selected.optInKeywords || []);

  report.a2pCampaignKeywords = {
    optOut: twilioOptOutKeywords,
    optIn: twilioOptInKeywords,
    help: twilioHelpKeywords
  };

  const missingStopInCode = twilioOptOutKeywords.filter((k) => !expectedStopKeywords.includes(k));
  if (missingStopInCode.length) {
    addFinding(
      findings,
      'warn',
      'keyword_mismatch_stop',
      'Twilio campaign opt-out keywords include values our inbound handler does not treat as STOP. This can prevent internal opt-out logging/state updates for those keywords.',
      { missingInCode: missingStopInCode, codeStopKeywords: expectedStopKeywords }
    );
  }

  const missingHelpInCode = twilioHelpKeywords.filter((k) => !expectedHelpKeywords.includes(k));
  if (missingHelpInCode.length) {
    addFinding(
      findings,
      'warn',
      'keyword_mismatch_help',
      'Twilio campaign help keywords include values our inbound handler does not treat as HELP. This can prevent internal help-event logging for those keywords.',
      { missingInCode: missingHelpInCode, codeHelpKeywords: expectedHelpKeywords }
    );
  }

  const missingStartInCode = twilioOptInKeywords.filter((k) => !expectedStartKeywords.includes(k));
  if (missingStartInCode.length) {
    addFinding(
      findings,
      'warn',
      'keyword_mismatch_start',
      'Twilio campaign opt-in keywords include values our inbound handler does not treat as START. This can prevent internal opt-in logging/state updates for those keywords.',
      { missingInCode: missingStartInCode, codeStartKeywords: expectedStartKeywords }
    );
  }

  if (twilioOptOutKeywords.length && !twilioOptOutKeywords.includes('stop')) {
    addFinding(findings, 'warn', 'campaign_opt_out_keywords_missing_stop', 'Campaign optOutKeywords does not include STOP.', { optOutKeywords: twilioOptOutKeywords });
  }
  if (twilioHelpKeywords.length && !twilioHelpKeywords.includes('help')) {
    addFinding(findings, 'warn', 'campaign_help_keywords_missing_help', 'Campaign helpKeywords does not include HELP.', { helpKeywords: twilioHelpKeywords });
  }

  const twilioHelpMessage = String(selected.helpMessage || '').trim();
  const twilioOptOutMessage = String(selected.optOutMessage || '').trim();
  const twilioOptInMessage = String(selected.optInMessage || '').trim();

  report.a2pCampaignMessages = {
    optIn: twilioOptInMessage,
    optOut: twilioOptOutMessage,
    help: twilioHelpMessage
  };

  if (twilioHelpMessage && !includesToken(twilioHelpMessage, SUPPORT_EMAIL) && !hasHttpLink(twilioHelpMessage)) {
    addFinding(
      findings,
      'info',
      'campaign_help_missing_contact',
      'Campaign helpMessage does not include a support email or a link; verify this matches your Advanced Opt-Out configuration.',
      {}
    );
  }
  if (twilioOptOutMessage && !includesToken(twilioOptOutMessage, BRAND_NAME)) {
    addFinding(findings, 'info', 'campaign_opt_out_missing_brand', 'Campaign optOutMessage does not include the brand name.', {});
  }

  const codeMode = (process.env.TWILIO_OPT_OUT_MODE || 'twilio').trim().toLowerCase();
  if (codeMode !== 'twilio') {
    addFinding(
      findings,
      'info',
      'app_opt_out_mode',
      'App is configured to send STOP/START/HELP auto-replies (TWILIO_OPT_OUT_MODE=app). If Advanced Opt-Out is enabled on the Messaging Service, this can cause duplicate messages.',
      { TWILIO_OPT_OUT_MODE: process.env.TWILIO_OPT_OUT_MODE || '' }
    );
  } else {
    addFinding(
      findings,
      'info',
      'app_opt_out_mode',
      'App is configured to not send STOP/START/HELP auto-replies (TWILIO_OPT_OUT_MODE=twilio). This is recommended when using Twilio Default/Advanced Opt-Out.',
      {}
    );
  }

  if (selected.brandRegistrationSid) {
    try {
      const brand = await client.messaging.v1.brandRegistrations(selected.brandRegistrationSid).fetch();
      report.brandRegistration = brand.toJSON();
      const brandStatus = String(brand.status || '').toUpperCase();
      if (brandStatus && brandStatus !== 'APPROVED') {
        addFinding(findings, 'warn', 'brand_not_approved', 'Brand Registration status is not APPROVED.', {
          status: brand.status,
          identityStatus: brand.identityStatus
        });
      }
    } catch (err: any) {
      addFinding(findings, 'warn', 'brand_fetch_failed', 'Failed to fetch Brand Registration.', {
        brandRegistrationSid: selected.brandRegistrationSid,
        error: err?.message || String(err)
      });
    }
  }

  if (verifyServiceSid) {
    try {
      const verifySvc = await client.verify.v2.services(verifyServiceSid).fetch();
      report.verifyService = verifySvc.toJSON();
    } catch (err: any) {
      addFinding(findings, 'warn', 'verify_fetch_failed', 'Failed to fetch Verify Service.', {
        verifyServiceSid,
        error: err?.message || String(err)
      });
    }
  } else {
    addFinding(findings, 'info', 'verify_missing', 'No `TWILIO_VERIFY_SERVICE_SID` configured; phone verification audit skipped.', {});
  }

  report.findings = findings;
  emit(report, opts);

  const errorCount = findings.filter((f) => f.level === 'error').length;
  const warnCount = findings.filter((f) => f.level === 'warn').length;
  if (errorCount > 0) process.exit(1);
  if (opts.failOnWarn && warnCount > 0) process.exit(2);
}

async function discoverMessagingServiceSidByFromNumber(client: any, fromNumberRaw: string, findings: Finding[]) {
  const fromNumber = fromNumberRaw.trim();
  if (!fromNumber) return '';

  addFinding(findings, 'info', 'service_discovery', 'Discovering Messaging Service from `TWILIO_FROM_NUMBER`.', { fromNumber: maskE164(fromNumber) });

  const services = await client.messaging.v1.services.list({ limit: 200 });
  if (!services.length) return '';

  const candidates: Array<{ sid: string; friendlyName: string; usAppToPersonRegistered: boolean }> = [];
  for (const service of services) {
    const serviceSid = String(service.sid || '').trim();
    if (!serviceSid) continue;

    let phoneNumbers: any[] = [];
    try {
      phoneNumbers = await client.messaging.v1.services(serviceSid).phoneNumbers.list({ limit: 1000 });
    } catch {
      continue;
    }

    if (phoneNumbers.some((row) => String(row.phoneNumber || '').trim() === fromNumber)) {
      candidates.push({
        sid: serviceSid,
        friendlyName: String(service.friendlyName || ''),
        usAppToPersonRegistered: Boolean(service.usAppToPersonRegistered)
      });
    }
  }

  if (!candidates.length) {
    addFinding(findings, 'warn', 'service_discovery_no_match', 'No Messaging Service found containing `TWILIO_FROM_NUMBER`.', {
      fromNumber: maskE164(fromNumber)
    });
    return '';
  }

  if (candidates.length > 1) {
    addFinding(
      findings,
      'warn',
      'service_discovery_multiple',
      'Multiple Messaging Services contain this `TWILIO_FROM_NUMBER`; selecting the first A2P-registered one.',
      { candidates }
    );
  }

  const preferred = candidates.find((c) => c.usAppToPersonRegistered) || candidates[0];
  addFinding(findings, 'info', 'service_discovery_selected', 'Selected Messaging Service for audit.', preferred);
  return preferred.sid;
}

function pickCampaign(campaigns: any[], campaignSid: string | null) {
  if (campaignSid) {
    const exact = campaigns.find((c) => String(c.sid) === campaignSid);
    if (exact) return exact;
  }
  const verified = campaigns.find((c) => String(c.campaignStatus || '').toUpperCase() === 'VERIFIED');
  if (verified) return verified;
  return campaigns[0] || null;
}

function emit(report: Record<string, unknown>, opts: Opts) {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  function truncateText(value: unknown, max = 220) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
  }

  const findings = Array.isArray(report.findings) ? (report.findings as Finding[]) : [];
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const infos = findings.filter((f) => f.level === 'info');

  console.log(`Twilio A2P audit for ${BRAND_NAME}`);
  console.log(`- Site URL: ${String(report.siteUrl || '')}`);
  console.log(`- Expected inbound: ${String(report.expectedInboundUrl || '')}`);

  const service = report.messagingService as any;
  if (service?.sid) {
    console.log(`- Messaging Service: ${service.sid} (${service.friendlyName || ''})`);
    console.log(`  - inboundRequestUrl: ${service.inboundRequestUrl || '(empty)'}`);
    console.log(`  - inboundMethod: ${service.inboundMethod || '(empty)'}`);
    console.log(`  - useInboundWebhookOnNumber: ${String(service.useInboundWebhookOnNumber)}`);
    console.log(`  - usAppToPersonRegistered: ${String(service.usAppToPersonRegistered)}`);
  }

  const campaign = report.a2pCampaignSelected as any;
  if (campaign?.sid) {
    console.log(`- A2P Campaign: ${campaign.sid} (status: ${campaign.campaignStatus || 'unknown'})`);
    console.log(`  - usecase: ${campaign.usAppToPersonUsecase || '(empty)'}`);
    console.log(`  - hasEmbeddedLinks: ${String(campaign.hasEmbeddedLinks)}`);
    console.log(`  - hasEmbeddedPhone: ${String(campaign.hasEmbeddedPhone)}`);
    console.log(`  - subscriberOptIn: ${String(campaign.subscriberOptIn)}`);
    console.log(`  - brandRegistrationSid: ${campaign.brandRegistrationSid || '(empty)'}`);
    console.log(`  - helpMessage: ${truncateText(campaign.helpMessage) || '(empty)'}`);
    console.log(`  - optOutMessage: ${truncateText(campaign.optOutMessage) || '(empty)'}`);
    console.log(`  - optInMessage: ${truncateText(campaign.optInMessage) || '(empty)'}`);
    console.log(`  - messageFlow: ${truncateText(campaign.messageFlow) || '(empty)'}`);

    const samples = Array.isArray(campaign.messageSamples) ? campaign.messageSamples : [];
    if (samples.length) {
      console.log(`  - messageSamples (${samples.length}):`);
      for (const sample of samples) console.log(`    - ${truncateText(sample, 160)}`);
    }

    const keywords = report.a2pCampaignKeywords as any;
    if (keywords?.optOut || keywords?.optIn || keywords?.help) {
      console.log(`  - keywords:`);
      if (Array.isArray(keywords.optOut)) console.log(`    - optOut: ${keywords.optOut.join(', ') || '(empty)'}`);
      if (Array.isArray(keywords.optIn)) console.log(`    - optIn: ${keywords.optIn.join(', ') || '(empty)'}`);
      if (Array.isArray(keywords.help)) console.log(`    - help: ${keywords.help.join(', ') || '(empty)'}`);
    }
  }

  if (findings.length) console.log('\nFindings:');
  for (const f of findings) {
    const prefix = f.level.toUpperCase().padEnd(5);
    console.log(`- [${prefix}] ${f.code}: ${f.message}`);
    if (f.details && Object.keys(f.details).length) {
      console.log(`  ${JSON.stringify(f.details)}`);
    }
  }

  console.log(`\nSummary: ${errors.length} error(s), ${warns.length} warning(s), ${infos.length} info`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
