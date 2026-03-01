// auth.js
// Handles login, register, gmail connect, and session persistence.
// Include AFTER supabase-client.js and BEFORE app.js

const { Auth, Profile, GmailConnect } = window.NexusDB;

// ─────────────────────────────────────────────
// PANEL SWITCHER
// ─────────────────────────────────────────────
function showPanel(name) {
  ['login', 'register', 'gmailConnect'].forEach(p => {
    const el = document.getElementById(`panel${p.charAt(0).toUpperCase() + p.slice(1)}`);
    if (el) el.classList.toggle('hidden', p !== name);
  });
  // Standardize: 'gmailConnect' maps to panelGmailConnect
  const gmailEl = document.getElementById('panelGmailConnect');
  if (gmailEl) gmailEl.classList.toggle('hidden', name !== 'gmailConnect');
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('btnLogin');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    await Auth.signIn(email, password);
    // onAuthStateChange will handle the rest
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Sign In';
    lucide.createIcons();
  }
}

// Enter key on login fields
['loginEmail', 'loginPassword'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
});

// ─────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────
async function handleRegister() {
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errEl    = document.getElementById('regError');
  const btn      = document.getElementById('btnRegister');

  errEl.classList.add('hidden');

  if (!name)              return showError(errEl, 'Please enter your full name.');
  if (!email)             return showError(errEl, 'Please enter your email address.');
  if (password.length < 8) return showError(errEl, 'Password must be at least 8 characters.');

  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    await Auth.signUp(email, password, name);
    showError(errEl, '✓ Check your email to confirm your account, then sign in.', 'text-emerald-400');
    btn.textContent = 'Account created!';
  } catch (err) {
    showError(errEl, err.message);
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="user-plus" class="w-4 h-4"></i> Create Account';
    lucide.createIcons();
  }
}

['regName', 'regEmail', 'regPassword'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleRegister();
  });
});

// ─────────────────────────────────────────────
// GMAIL CONNECT
// ─────────────────────────────────────────────
async function handleGmailConnect() {
  try {
    await GmailConnect.connect(); // redirects to Google
  } catch (err) {
    alert('Gmail connect failed: ' + err.message);
  }
}

// ─────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────
async function handleLogout() {
  await Auth.signOut();
  showAuthOverlay();
}

// ─────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────
async function initAuth() {
  // Check if returning from Gmail OAuth
  if (GmailConnect.checkCallback()) {
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const session = await Auth.getSession();
  if (session) {
    await onLoggedIn(session.user);
  } else {
    showAuthOverlay();
  }

  // Listen for future auth changes
  Auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await onLoggedIn(session.user);
    } else if (event === 'SIGNED_OUT') {
      showAuthOverlay();
    }
  });
}

async function onLoggedIn(user) {
  // Check if Gmail is connected
  const profile = await Profile.get();

  if (!profile?.gmail_connected) {
    // Show Gmail connect step
    document.getElementById('authOverlay').classList.remove('hidden');
    showPanel('gmailConnect');
    return;
  }

  // All good — hide overlay and show app
  hideAuthOverlay(user, profile);
}

function showAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  overlay.classList.remove('hidden');
  showPanel('login');
  document.getElementById('userBar').classList.add('hidden');
  document.getElementById('userBar').classList.remove('flex');
}

function hideAuthOverlay(user, profile) {
  document.getElementById('authOverlay').classList.add('hidden');

  // Update user bar in nav
  const bar = document.getElementById('userBar');
  bar.classList.remove('hidden');
  bar.classList.add('flex');
  document.getElementById('userEmailDisplay').textContent = profile?.gmail_email || user.email;

  // Update credits display from profile
  const creditsEl = document.getElementById('creditsLeft');
  if (creditsEl && profile) {
    const remaining = profile.daily_quota - profile.emails_sent_today;
    creditsEl.textContent = remaining.toLocaleString();
    creditsEl.className   = remaining > 50
      ? 'text-xl font-mono text-emerald-400'
      : remaining > 10
        ? 'text-xl font-mono text-yellow-400'
        : 'text-xl font-mono text-red-400';
  }

  lucide.createIcons();
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function showError(el, msg, cls = 'text-red-400') {
  el.textContent = msg;
  el.className   = `text-xs mt-3 ${cls}`;
  el.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initAuth);

// ─────────────────────────────────────────────
// EXPOSE TO GLOBAL SCOPE
// Required because inline onclick="..." attributes
// need functions on window, not just module scope
// ─────────────────────────────────────────────
window.showPanel        = showPanel;
window.handleLogin      = handleLogin;
window.handleRegister   = handleRegister;
window.handleGmailConnect = handleGmailConnect;
window.handleLogout     = handleLogout;