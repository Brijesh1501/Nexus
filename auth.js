// auth.js — NexusMail authentication
// All Supabase calls go through window.NexusDB (set by supabase-client.js)
// No top-level const declarations that could clash with supabase-client.js globals

// ─────────────────────────────────────────────
// PANEL SWITCHER
// ─────────────────────────────────────────────
function showPanel(name) {
  ['login', 'register', 'gmailConnect'].forEach(function(p) {
    var el = document.getElementById('panel' + p.charAt(0).toUpperCase() + p.slice(1));
    if (el) el.classList.toggle('hidden', p !== name);
  });
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
async function handleLogin() {
  var email    = document.getElementById('loginEmail').value.trim();
  var password = document.getElementById('loginPassword').value;
  var errEl    = document.getElementById('loginError');
  var btn      = document.getElementById('btnLogin');

  errEl.classList.add('hidden');
  btn.disabled    = true;
  btn.textContent = 'Signing in...';

  try {
    await window.NexusDB.Auth.signIn(email, password);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    btn.disabled  = false;
    btn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Sign In';
    lucide.createIcons();
  }
}

// ─────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────
async function handleRegister() {
  var name     = document.getElementById('regName').value.trim();
  var email    = document.getElementById('regEmail').value.trim();
  var password = document.getElementById('regPassword').value;
  var errEl    = document.getElementById('regError');
  var btn      = document.getElementById('btnRegister');

  errEl.classList.add('hidden');

  if (!name)               return _showFormError(errEl, 'Please enter your full name.');
  if (!email)              return _showFormError(errEl, 'Please enter your email address.');
  if (password.length < 8) return _showFormError(errEl, 'Password must be at least 8 characters.');

  btn.disabled    = true;
  btn.textContent = 'Creating account...';

  try {
    await window.NexusDB.Auth.signUp(email, password, name);
    _showFormError(errEl, 'Account created! You can now sign in.', 'text-emerald-400');
    btn.textContent = 'Account created!';
  } catch (e) {
    _showFormError(errEl, e.message);
    btn.disabled  = false;
    btn.innerHTML = '<i data-lucide="user-plus" class="w-4 h-4"></i> Create Account';
    lucide.createIcons();
  }
}

// ─────────────────────────────────────────────
// GMAIL CONNECT
// ─────────────────────────────────────────────
async function handleGmailConnect() {
  try {
    await window.NexusDB.GmailConnect.connect();
  } catch (e) {
    alert('Gmail connect failed: ' + e.message);
  }
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────
async function handleLogout() {
  await window.NexusDB.Auth.signOut();
  _showAuthOverlay();
}

// ─────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────
async function _initAuth() {
  if (window.NexusDB.GmailConnect.checkCallback()) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  var session = await window.NexusDB.Auth.getSession();
  if (session) {
    await _onLoggedIn(session.user);
  } else {
    _showAuthOverlay();
  }

  window.NexusDB.Auth.onAuthStateChange(async function(event, session) {
    if (event === 'SIGNED_IN' && session) {
      await _onLoggedIn(session.user);
    } else if (event === 'SIGNED_OUT') {
      _showAuthOverlay();
    }
  });
}

async function _onLoggedIn(user) {
  try {
    var profile = await window.NexusDB.Profile.get();
    if (!profile || !profile.gmail_connected) {
      document.getElementById('authOverlay').classList.remove('hidden');
      showPanel('gmailConnect');
      return;
    }
    _hideAuthOverlay(user, profile);
  } catch (e) {
    console.error('onLoggedIn error:', e);
    _showAuthOverlay();
  }
}

function _showAuthOverlay() {
  document.getElementById('authOverlay').classList.remove('hidden');
  showPanel('login');
  var bar = document.getElementById('userBar');
  if (bar) { bar.classList.add('hidden'); bar.classList.remove('flex'); }
}

function _hideAuthOverlay(user, profile) {
  document.getElementById('authOverlay').classList.add('hidden');
  var bar = document.getElementById('userBar');
  if (bar) { bar.classList.remove('hidden'); bar.classList.add('flex'); }

  var emailEl = document.getElementById('userEmailDisplay');
  if (emailEl) emailEl.textContent = (profile && profile.gmail_email) ? profile.gmail_email : user.email;

  var creditsEl = document.getElementById('creditsLeft');
  if (creditsEl && profile) {
    var remaining = (profile.daily_quota || 100) - (profile.emails_sent_today || 0);
    creditsEl.textContent = remaining.toLocaleString();
    creditsEl.className   = remaining > 50
      ? 'text-xl font-mono text-emerald-400'
      : remaining > 10
        ? 'text-xl font-mono text-yellow-400'
        : 'text-xl font-mono text-red-400';
  }

  lucide.createIcons();
}

function _showFormError(el, msg, cls) {
  el.textContent = msg;
  el.className   = 'text-xs mt-3 ' + (cls || 'text-red-400');
  el.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  _initAuth();

  document.getElementById('btnLogin')?.addEventListener('click', handleLogin);
  document.getElementById('loginEmail')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('loginPassword')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleLogin(); });

  document.getElementById('btnRegister')?.addEventListener('click', handleRegister);
  ['regName', 'regEmail', 'regPassword'].forEach(function(id) {
    document.getElementById(id)?.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleRegister(); });
  });

  document.getElementById('btnGmailConnect')?.addEventListener('click', handleGmailConnect);
  document.getElementById('btnSignOutFromConnect')?.addEventListener('click', handleLogout);
  document.getElementById('btnLogout')?.addEventListener('click', handleLogout);

  document.querySelectorAll('[data-panel]').forEach(function(el) {
    el.addEventListener('click', function() { showPanel(el.dataset.panel); });
  });
});