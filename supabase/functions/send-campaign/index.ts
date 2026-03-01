// supabase/functions/send-campaign/index.ts
// Deploy: supabase functions deploy send-campaign
//
// This Edge Function runs SERVER-SIDE (Deno runtime).
// It reads the user's stored Gmail OAuth refresh token,
// gets a fresh access token, and sends the email via Gmail API.
// The SECRET_KEY problem is gone — auth is handled by Supabase JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID  = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const ENCRYPTION_KEY    = Deno.env.get("TOKEN_ENCRYPTION_KEY")!; // 32-char key

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verify the user's JWT from the Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const { action } = body;

    // ── Route actions ──────────────────────────────────────
    if (action === "send_single")   return await sendSingle(supabase, user, body, corsHeaders);
    if (action === "send_campaign") return await sendCampaignBatch(supabase, user, body, corsHeaders);
    if (action === "test_email")    return await sendTestEmail(supabase, user, body, corsHeaders);

    throw new Error(`Unknown action: ${action}`);

  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────
// SEND SINGLE / TEST EMAIL
// ─────────────────────────────────────────────
async function sendTestEmail(supabase: any, user: any, body: any, headers: any) {
  const { recipient, subject, htmlBody, senderName, attachments = [] } = body;

  const accessToken = await getGmailAccessToken(supabase, user.id);
  await sendViaGmailAPI({ accessToken, recipient, subject: `[TEST] ${subject}`, htmlBody, senderName, attachments });

  return json({ success: true, message: `Test sent to ${recipient}` }, headers);
}

async function sendSingle(supabase: any, user: any, body: any, headers: any) {
  const { recipient, subject, htmlBody, senderName, attachments = [], campaignId, recipientId } = body;

  const accessToken = await getGmailAccessToken(supabase, user.id);
  await sendViaGmailAPI({ accessToken, recipient, subject, htmlBody, senderName, attachments });

  // Update campaign recipient status
  if (recipientId) {
    await supabase
      .from("campaign_recipients")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", recipientId);
  }

  // Increment counters
  if (campaignId) {
    await supabase.rpc("increment_sent", { p_campaign_id: campaignId, p_user_id: user.id });
  }

  return json({ success: true }, headers);
}

async function sendCampaignBatch(supabase: any, user: any, body: any, headers: any) {
  // This handles a single email in a campaign batch.
  // The frontend calls this once per recipient with a delay between calls.
  // For true server-side queuing, see the Supabase pg_cron approach below.
  return sendSingle(supabase, user, body, headers);
}

// ─────────────────────────────────────────────
// GMAIL API
// ─────────────────────────────────────────────
async function getGmailAccessToken(supabase: any, userId: string): Promise<string> {
  // Fetch encrypted refresh token from DB
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("gmail_refresh_token, gmail_connected")
    .eq("id", userId)
    .single();

  if (error || !profile) throw new Error("Profile not found");
  if (!profile.gmail_connected) throw new Error("Gmail not connected. Please connect your Gmail account first.");

  // Decrypt the refresh token
  const refreshToken = await decrypt(profile.gmail_refresh_token, ENCRYPTION_KEY);

  // Exchange for access token via Google OAuth
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });

  const tokenData = await res.json();
  if (tokenData.error) throw new Error(`Token refresh failed: ${tokenData.error_description}`);
  return tokenData.access_token;
}

async function sendViaGmailAPI({
  accessToken, recipient, subject, htmlBody, senderName, attachments
}: {
  accessToken: string;
  recipient: string;
  subject: string;
  htmlBody: string;
  senderName: string;
  attachments: Array<{ name: string; mimeType: string; data: string }>;
}) {
  // Build RFC 2822 MIME email
  const boundary = `nexusmail_${Date.now()}`;
  const hasAttachments = attachments && attachments.length > 0;

  let emailLines: string[] = [
    `To: ${recipient}`,
    `Subject: ${subject}`,
    `From: ${senderName} <me>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/${hasAttachments ? "mixed" : "alternative"}; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    "",
    btoa(unescape(encodeURIComponent(htmlBody))),
  ];

  if (hasAttachments) {
    for (const att of attachments) {
      emailLines = emailLines.concat([
        "",
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name="${att.name}"`,
        `Content-Disposition: attachment; filename="${att.name}"`,
        `Content-Transfer-Encoding: base64`,
        "",
        att.data,
      ]);
    }
  }

  emailLines.push(`--${boundary}--`);

  const rawEmail = emailLines.join("\r\n");
  const encodedEmail = btoa(rawEmail).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodedEmail }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Gmail API error: ${err.error?.message || JSON.stringify(err)}`);
  }
}

// ─────────────────────────────────────────────
// ENCRYPTION HELPERS (AES-GCM for refresh token)
// ─────────────────────────────────────────────
async function encrypt(text: string, keyStr: string): Promise<string> {
  const key = await importKey(keyStr);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  const buf = new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
  return btoa(String.fromCharCode(...buf));
}

async function decrypt(ciphertext: string, keyStr: string): Promise<string> {
  const key   = await importKey(keyStr);
  const buf   = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const iv    = buf.slice(0, 12);
  const data  = buf.slice(12);
  const dec   = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(dec);
}

async function importKey(keyStr: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(keyStr.slice(0, 32).padEnd(32, "0"));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// ─────────────────────────────────────────────
// RESPONSE HELPER
// ─────────────────────────────────────────────
function json(data: any, headers: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}