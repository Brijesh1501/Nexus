// supabase-client.js
// Include this BEFORE app.js in your HTML:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
// <script src="supabase-client.js"></script>

// ─────────────────────────────────────────────
// CONFIG — replace with your project values
// ─────────────────────────────────────────────
const SUPABASE_URL  = "https://nbzacndkflkpivdiptem.supabase.co";
const SUPABASE_ANON = "sb_publishable_kXDzso2PWGO9UoVh8zT9ow_FCn2j1Sb";
const EDGE_BASE     = `${SUPABASE_URL}/functions/v1`;

// Init Supabase client
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ─────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────
const Auth = {
  // Sign up with email + password
  async signUp(email, password, fullName) {
    const { data, error } = await _supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }
    });
    if (error) throw error;
    return data;
  },

  // Sign in
  async signIn(email, password) {
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  // Sign out
  async signOut() {
    const { error } = await _supabase.auth.signOut();
    if (error) throw error;
  },

  // Get current session
  async getSession() {
    const { data: { session } } = await _supabase.auth.getSession();
    return session;
  },

  // Get current user
  async getUser() {
    const { data: { user } } = await _supabase.auth.getUser();
    return user;
  },

  // Listen for auth state changes
  onAuthStateChange(callback) {
    return _supabase.auth.onAuthStateChange(callback);
  },

  // Get JWT for Edge Function calls
  async getToken() {
    const session = await this.getSession();
    return session?.access_token || null;
  }
};

// ─────────────────────────────────────────────
// PROFILE HELPERS
// ─────────────────────────────────────────────
const Profile = {
  async get() {
    const user = await Auth.getUser();
    if (!user) return null;
    const { data, error } = await _supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return data;
  },

  async update(updates) {
    const user = await Auth.getUser();
    const { error } = await _supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) throw error;
  }
};

// ─────────────────────────────────────────────
// GMAIL OAUTH HELPERS
// ─────────────────────────────────────────────
const GmailConnect = {
  // Get the Google consent URL and redirect user to it
  async connect() {
    const token = await Auth.getToken();
    const res = await fetch(`${EDGE_BASE}/gmail-oauth?action=url`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { url, error } = await res.json();
    if (error) throw new Error(error);
    window.location.href = url; // redirect to Google consent screen
  },

  // Check URL for ?gmail=connected after OAuth redirect
  checkCallback() {
    const params = new URLSearchParams(window.location.search);
    return params.get('gmail') === 'connected';
  }
};

// ─────────────────────────────────────────────
// CONTACTS HELPERS
// ─────────────────────────────────────────────
const Contacts = {
  async list({ search = '', tag = '', unsubscribed = false } = {}) {
    let query = _supabase.from('contacts').select('*').order('created_at', { ascending: false });
    if (search) query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    if (tag)    query = query.contains('tags', [tag]);
    if (!unsubscribed) query = query.eq('unsubscribed', false);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(contact) {
    const user = await Auth.getUser();
    const { data, error } = await _supabase
      .from('contacts')
      .insert({ ...contact, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { error } = await _supabase
      .from('contacts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async delete(id) {
    const { error } = await _supabase.from('contacts').delete().eq('id', id);
    if (error) throw error;
  },

  // Bulk import from CSV array
  async bulkImport(rows) {
    const user = await Auth.getUser();
    const contacts = rows.map(r => ({
      user_id:    user.id,
      email:      r.email,
      first_name: r.firstName || r.first_name || '',
      last_name:  r.lastName  || r.last_name  || '',
      company:    r.company   || '',
    }));
    // upsert — updates existing emails instead of duplicating
    const { data, error } = await _supabase
      .from('contacts')
      .upsert(contacts, { onConflict: 'user_id,email' })
      .select();
    if (error) throw error;
    return data;
  }
};

// ─────────────────────────────────────────────
// TEMPLATES HELPERS
// ─────────────────────────────────────────────
const Templates = {
  async list() {
    const { data, error } = await _supabase
      .from('templates')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async save(template) {
    const user = await Auth.getUser();
    const { data, error } = await _supabase
      .from('templates')
      .upsert({ ...template, user_id: user.id, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await _supabase.from('templates').delete().eq('id', id);
    if (error) throw error;
  }
};

// ─────────────────────────────────────────────
// CAMPAIGNS HELPERS
// ─────────────────────────────────────────────
const Campaigns = {
  async list() {
    const { data, error } = await _supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async get(id) {
    const { data, error } = await _supabase
      .from('campaigns')
      .select(`*, campaign_recipients(*)`)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(campaign) {
    const user = await Auth.getUser();
    const { data, error } = await _supabase
      .from('campaigns')
      .insert({ ...campaign, user_id: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateStatus(id, status, extra = {}) {
    const { error } = await _supabase
      .from('campaigns')
      .update({ status, ...extra, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // Snapshot recipients into campaign_recipients table
  async addRecipients(campaignId, recipients) {
    const rows = recipients.map((r, i) => ({
      campaign_id: campaignId,
      email:       r.email,
      first_name:  r.firstName || r.first_name || '',
      last_name:   r.lastName  || r.last_name  || '',
      company:     r.company   || '',
      status:      'pending',
      position:    i,
    }));
    const { error } = await _supabase.from('campaign_recipients').insert(rows);
    if (error) throw error;
  },

  async getPendingRecipients(campaignId) {
    const { data, error } = await _supabase
      .from('campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('position');
    if (error) throw error;
    return data;
  }
};

// ─────────────────────────────────────────────
// EMAIL SENDING (via Edge Function)
// ─────────────────────────────────────────────
const EmailService = {
  async sendTest({ recipient, subject, htmlBody, senderName, attachments = [] }) {
    return this._call('test_email', { recipient, subject, htmlBody, senderName, attachments });
  },

  async sendOne({ recipient, subject, htmlBody, senderName, attachments = [], campaignId, recipientId }) {
    return this._call('send_single', { recipient, subject, htmlBody, senderName, attachments, campaignId, recipientId });
  },

  async _call(action, payload) {
    const token = await Auth.getToken();
    if (!token) throw new Error("Not authenticated");

    const res = await fetch(`${EDGE_BASE}/send-campaign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ action, ...payload })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Edge function error');
    return data;
  }
};

// ─────────────────────────────────────────────
// CAMPAIGN SEND LOOP (replaces the old fetch loop)
// Works exactly like the old runSendLoop but:
//   - Sends via EmailService (Edge Function → Gmail API)
//   - Saves status per recipient to Supabase
//   - Can be resumed from DB state even after page refresh
// ─────────────────────────────────────────────
async function runSupabaseCampaign({
  campaignId,
  subject,
  htmlBody,
  senderName,
  attachments = [],
  delaySeconds = 30,
  onProgress,   // callback(sent, total, recipientEmail)
  onLog,        // callback(message, color)
  shouldAbort,  // function() => boolean
}) {
  // Mark campaign as running
  await Campaigns.updateStatus(campaignId, 'running', { started_at: new Date().toISOString() });

  // Get all pending recipients from DB
  const recipients = await Campaigns.getPendingRecipients(campaignId);
  const total = recipients.length;
  let sentCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    if (shouldAbort && shouldAbort()) {
      await Campaigns.updateStatus(campaignId, 'paused', { current_index: i });
      onLog?.(`PAUSED: ${total - i} remaining. Resume anytime.`, 'text-yellow-400');
      return;
    }

    const r = recipients[i];

    // Build personalized body
    let personalizedBody = htmlBody;
    personalizedBody = personalizedBody.replace(/\{firstName\}/gi, r.first_name || '');
    personalizedBody = personalizedBody.replace(/\{lastName\}/gi,  r.last_name  || '');
    personalizedBody = personalizedBody.replace(/\{company\}/gi,   r.company    || '');
    personalizedBody = personalizedBody.replace(/\{email\}/gi,     r.email      || '');

    onLog?.(`Transmitting [${i + 1}/${total}] ${r.email}`);

    try {
      await EmailService.sendOne({
        recipient:   r.email,
        subject,
        htmlBody:    personalizedBody,
        senderName,
        attachments,
        campaignId,
        recipientId: r.id,
      });

      sentCount++;
      onProgress?.(sentCount, total, r.email);
      onLog?.(`OK: ${r.email}`, 'text-emerald-400');

    } catch (err) {
      // Mark this recipient as failed in DB
      await _supabase
        .from('campaign_recipients')
        .update({ status: 'failed', error_msg: err.message })
        .eq('id', r.id);

      onLog?.(`ERROR: ${r.email} — ${err.message}`, 'text-red-400');
    }

    // Delay between sends
    if (i < recipients.length - 1 && !(shouldAbort && shouldAbort())) {
      const jitter = Math.floor(Math.random() * 11) - 5;
      const delay  = Math.max(5, delaySeconds + jitter);
      onLog?.(`Waiting ${delay}s...`, 'text-orange-400');
      await new Promise(r => setTimeout(r, delay * 1000));
    }
  }

  // Mark completed
  await Campaigns.updateStatus(campaignId, 'completed', {
    completed_at: new Date().toISOString()
  });
  onLog?.('CAMPAIGN COMPLETED SUCCESSFULLY.', 'text-blue-400 font-bold');
}

// Export everything to window scope so app.js can use it
window.NexusDB = { Auth, Profile, GmailConnect, Contacts, Templates, Campaigns, EmailService, runSupabaseCampaign };