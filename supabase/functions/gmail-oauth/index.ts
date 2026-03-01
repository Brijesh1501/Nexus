// supabase/functions/gmail-oauth/index.ts
// Deploy: supabase functions deploy gmail-oauth
//
// Handles two routes:
//   GET  ?action=url   → returns the Google OAuth consent URL
//   GET  ?action=callback&code=xxx  → exchanges code for tokens, stores encrypted refresh token

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID    = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const ENCRYPTION_KEY      = Deno.env.get("TOKEN_ENCRYPTION_KEY")!;
const REDIRECT_URI        = Deno.env.get("OAUTH_REDIRECT_URI")!;
// e.g. https://your-project.supabase.co/functions/v1/gmail-oauth?action=callback

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── 1. Return OAuth consent URL ──────────────────────────
  if (action === "url") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("Missing Authorization", 401);

    // State = user JWT (we'll verify it in the callback)
    const state = authHeader.replace("Bearer ", "");

    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id",     GOOGLE_CLIENT_ID);
    googleUrl.searchParams.set("redirect_uri",  REDIRECT_URI);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope",         SCOPES);
    googleUrl.searchParams.set("access_type",   "offline");
    googleUrl.searchParams.set("prompt",        "consent"); // force refresh_token
    googleUrl.searchParams.set("state",         state);

    return new Response(JSON.stringify({ url: googleUrl.toString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 2. OAuth callback — exchange code for tokens ─────────
  if (action === "callback") {
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // this is the user's JWT

    if (!code || !state) return err("Missing code or state");

    // Verify the user JWT from state
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
    const { data: { user }, error: authError } = await supabase.auth.getUser(state);
    if (authError || !user) return err("Invalid state token", 401);

    // Exchange auth code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) return err(`OAuth error: ${tokens.error_description}`);

    // Get the Gmail address
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json();

    // Encrypt and store the refresh token
    const encryptedToken = await encrypt(tokens.refresh_token, ENCRYPTION_KEY);

    await supabase
      .from("profiles")
      .update({
        gmail_refresh_token: encryptedToken,
        gmail_email:         info.email,
        gmail_connected:     true,
        updated_at:          new Date().toISOString(),
      })
      .eq("id", user.id);

    // Redirect back to the app with success
    return Response.redirect(`${Deno.env.get("APP_URL")}?gmail=connected`, 302);
  }

  return err("Unknown action");
});

// ─────────────────────────────────────────────
// ENCRYPTION (same as send-campaign function)
// ─────────────────────────────────────────────
async function encrypt(text: string, keyStr: string): Promise<string> {
  const key = await importKey(keyStr);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  const buf = new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
  return btoa(String.fromCharCode(...buf));
}

async function importKey(keyStr: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(keyStr.slice(0, 32).padEnd(32, "0"));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}