# SMS Opt-In / A2P 10DLC Verification Checklist (Twilio)

This doc is an internal checklist for our Twilio A2P campaign submission and ongoing compliance.

For the full process, common failure modes, and paste‑ready campaign content, see `docs/twilio-a2p-10dlc-verification-playbook.md`.

## Public links (Twilio reviewers may check these)
- Terms: `/legal/terms`
- Privacy: `/legal/privacy`
- FAQ: `/docs/faq`
- SMS opt-in (CTA proof): `/docs/sms-opt-in`

## Opt-in flow (website)
1. User signs in and navigates to `Notifications` (`/me/preferences`).
2. User enters a US phone number.
3. User reviews the SMS disclosure and checks “I agree”.
4. User requests a verification code (Twilio Verify) and enters the code to confirm phone ownership.
5. User enables “SMS alerts” and saves preferences.
6. On first opt-in, the system sends a confirmation SMS including STOP/HELP instructions.

## Opt-out / Help (SMS keywords)
- STOP keywords: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPTOUT`, `REVOKE`
- START keywords: `START`, `UNSTOP`
- HELP keywords: `HELP`, `INFO`

## Advanced Opt-Out (Messaging Service)
- If Twilio Default/Advanced Opt-Out is enabled on the Messaging Service, Twilio sends the STOP/START/HELP auto-replies.
- Our inbound handler still records keyword events and updates internal preferences, but (by default) does not send a second auto-reply (`TWILIO_OPT_OUT_MODE=twilio`).

## Message content expectations
- All outbound alerts are branded (prefix includes the brand name).
- Confirmation/resubscribe messaging includes:
  - Program/brand identification
  - Message frequency disclosure (“Msg freq varies”)
  - “Message and data rates may apply”
  - STOP/HELP instructions

## Proof of consent (auditability)
- Consent and SMS lifecycle events are recorded in `sms_consent_events`:
  - Web opt-in / opt-out events include request metadata (IP, user agent, request URL) when available.
  - Keyword STOP/START/HELP events are recorded for inbound messages.
  - Twilio opt-out enforcement errors (e.g., recipients who have replied STOP) are recorded when detected during send.

## Suggested message samples for Twilio submission
- Opt-in confirmation: “<Brand> SMS alerts enabled. Msg freq varies. Message and data rates may apply. Reply STOP to cancel, HELP for help. Support: support@tminuszero.app.”
- Scheduled reminder: “<Brand>: <Launch> T-10. Launch at <time>. Status: <status>”
- Timing/status update: “<Brand>: <Launch> time updated: <new time> (was <old time>). Status: <status>.”

Example placeholder values (5 each):

- `<Brand>`: `T‑Minus Zero`, `T-Minus Zero`, `TMinusZero`, `T‑Minus Zero Alerts`, `T‑Minus Zero Launch Alerts`
- `<Launch>`: `Falcon 9 Block 5 | Starlink Group 6-98`, `Atlas V 551 | USSF-51`, `Starship | Integrated Flight Test 3`, `Electron | “They Go Up So Fast”`, `Vulcan VC2S | Peregrine`
- `<time>`: `Jan 14, 6:08 PM UTC`, `Feb 01, 9:30 AM UTC`, `Mar 22, 11:45 PM UTC`, `Apr 05, 3:15 PM UTC`, `May 19, 7:00 AM UTC`
- `<status>`: `go`, `TBD`, `hold`, `scrubbed`, `Success`
- `<new time>`: `Jan 14, 6:08 PM UTC`, `Feb 01, 9:30 AM UTC`, `Mar 22, 11:45 PM UTC`, `Apr 05, 3:15 PM UTC`, `May 19, 7:00 AM UTC`
- `<old time>`: `Jan 14, 6:01 PM UTC`, `Feb 01, 9:10 AM UTC`, `Mar 22, 11:15 PM UTC`, `Apr 05, 2:55 PM UTC`, `May 19, 6:30 AM UTC`

## Twilio campaign fields (paste-ready)

### Message flow
Use a detailed flow that explicitly mentions consent, STOP/HELP, and links to Terms/Privacy, for example:

> Users create an account on https://www.tminuszero.app and (if desired) upgrade to Premium. In Notifications (https://www.tminuszero.app/me/preferences), users enter their phone number, check an unchecked consent checkbox agreeing to receive recurring automated SMS rocket launch alerts with message frequency varying, and confirm that Message and data rates may apply and consent is not a condition of purchase. Users request a one-time verification code (Twilio Verify) and enter the code to confirm ownership, then enable “SMS alerts” and save preferences to opt in. After opt-in, users receive a confirmation text. Users can opt out at any time by replying STOP (or any STOP keyword) and can get help by replying HELP/INFO or emailing support@tminuszero.app. Terms: https://www.tminuszero.app/legal/terms Privacy: https://www.tminuszero.app/legal/privacy
>
> Originating number(s) (US 10DLC): +14075888658
>
> CTA proof (opt-in is behind login; SMS is currently unavailable pending A2P approval): https://www.tminuszero.app/docs/sms-opt-in

### Message samples (match production formatting)
- “T-Minus Zero: <Launch> T-10. Launch at <time>. Status: <status>”
- “T-Minus Zero: <Launch> status update: <new status> (was <old status>). Launch at <time>.”
- “T-Minus Zero: <Launch> time updated: <new time> (was <old time>). Status: <status>.”

Example values for `<new status>` and `<old status>` (5 each):

- `<new status>`: `Success`, `In Flight`, `TBD`, `go`, `hold`
- `<old status>`: `go`, `In Flight`, `TBD`, `hold`, `scrubbed`

## Advanced Opt-Out (Twilio) copy
If Advanced Opt-Out is enabled and the app is in `TWILIO_OPT_OUT_MODE=twilio`, make sure Twilio’s STOP/HELP auto-replies include brand + a support contact (email or link), e.g.:
- HELP auto-reply: “T-Minus Zero alerts. Msg freq varies. Message and data rates may apply. Reply STOP to cancel. Support: support@tminuszero.app.”
- STOP auto-reply: “You are unsubscribed from T-Minus Zero alerts. You will not receive any more messages. Reply START to resubscribe.”

## Audit command
- `npm run twilio:a2p:audit -- --site-url https://www.tminuszero.app` (use the same host as the Messaging Service `inboundRequestUrl`)
