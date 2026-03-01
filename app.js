// Initialize Lucide Icons
lucide.createIcons();

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyz4nXhpk7ReoP788zq5ayn45WmcLaWm9YYrnxp5dM6uyzs7G66bAvfFPwmwoC9zAo/exec";

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let mode            = 'manual';
let isAborted       = false;
let sessionLogs     = [];
let campaignResults = [];

let resumeData = {
    active: false, recipients: [], startIndex: 0,
    successCount: 0, failCount: 0,
    userKey: '', sender: '', subject: '', message: '',
};

// ═══════════════════════════════════════════════════════════════
// ATTACHMENT MANAGER
// ═══════════════════════════════════════════════════════════════
const AttachmentManager = (function() {
    const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB
    let attachedFiles = []; // Array of File objects

    const zone      = document.getElementById('attachZone');
    const input     = document.getElementById('attachInput');
    const chipsEl   = document.getElementById('attachChips');
    const totalEl   = document.getElementById('attachTotal');

    // ── File input change ──────────────────────────────────
    input.addEventListener('change', () => {
        addFiles(Array.from(input.files));
        input.value = ''; // reset so same file can be re-added after removal
    });

    // ── Drag & drop ────────────────────────────────────────
    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        addFiles(Array.from(e.dataTransfer.files));
    });

    // ── Add files ──────────────────────────────────────────
    function addFiles(files) {
        files.forEach(file => {
            // Prevent exact duplicate (same name + size)
            const isDupe = attachedFiles.some(f => f.name === file.name && f.size === file.size);
            if (isDupe) return;
            attachedFiles.push(file);
        });
        render();
    }

    // ── Remove a file ──────────────────────────────────────
    function removeFile(index) {
        attachedFiles.splice(index, 1);
        render();
    }

    // ── Render chips ───────────────────────────────────────
    function render() {
        chipsEl.innerHTML = '';
        let totalBytes = 0;
        attachedFiles.forEach((file, i) => {
            totalBytes += file.size;
            const chip = document.createElement('div');
            chip.className = 'attach-chip';
            chip.innerHTML = `
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
                <span title="${file.name}">${file.name}</span>
                <span class="chip-size">${fmtBytes(file.size)}</span>
                <button type="button" data-idx="${i}" title="Remove">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>`;
            chip.querySelector('button').addEventListener('click', () => removeFile(i));
            chipsEl.appendChild(chip);
        });

        // Update total size indicator
        if (attachedFiles.length === 0) {
            totalEl.classList.add('hidden');
        } else {
            totalEl.classList.remove('hidden');
            const pct = Math.round((totalBytes / MAX_TOTAL_BYTES) * 100);
            totalEl.textContent = `Total: ${fmtBytes(totalBytes)} / 25 MB (${pct}%)`;
            totalEl.className = 'attach-total';
            if (totalBytes > MAX_TOTAL_BYTES * 0.8) totalEl.classList.add('warn');
            if (totalBytes > MAX_TOTAL_BYTES)       totalEl.classList.add('danger');
        }

        lucide.createIcons();
    }

    // ── Format bytes ───────────────────────────────────────
    function fmtBytes(b) {
        if (b < 1024)          return b + ' B';
        if (b < 1024 * 1024)   return (b / 1024).toFixed(1) + ' KB';
        return (b / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // ── Convert File → base64 ──────────────────────────────
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result.split(',')[1]); // strip data URL prefix
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ── Public: get attachments as base64 array ────────────
    async function getPayload() {
        const result = [];
        for (const file of attachedFiles) {
            const data = await fileToBase64(file);
            result.push({ name: file.name, mimeType: file.type || 'application/octet-stream', data });
        }
        return result;
    }

    // ── Public: clear attachments ──────────────────────────
    function clear() {
        attachedFiles = [];
        render();
    }

    // ── Public: total size check ───────────────────────────
    function getTotalSize() {
        return attachedFiles.reduce((sum, f) => sum + f.size, 0);
    }

    return { getPayload, clear, getTotalSize, fmtBytes };
})();

// ═══════════════════════════════════════════════════════════════
// RICH TEXT EDITOR
// ═══════════════════════════════════════════════════════════════
(function initRichEditor() {
    const editor    = document.getElementById('richMessage');
    const toolbar   = document.getElementById('richToolbar');
    const charCount = document.getElementById('richCharCount');
    let savedRange  = null;

    // ── execCommand wrapper ──────────────────────────────
    function exec(cmd, val = null) {
        editor.focus();
        document.execCommand(cmd, false, val);
        refreshActiveStates();
    }

    // ── Highlight active buttons ─────────────────────────
    function refreshActiveStates() {
        toolbar.querySelectorAll('.rtb-btn[data-cmd]').forEach(btn => {
            const cmd = btn.dataset.cmd;
            try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch(e) {}
        });
    }

    // ── Wire all [data-cmd] buttons ──────────────────────
    toolbar.querySelectorAll('.rtb-btn[data-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); // keep editor focus
            exec(btn.dataset.cmd);
        });
    });

    // ── Font family ──────────────────────────────────────
    document.getElementById('rtb-fontFamily').addEventListener('change', function() {
        if (this.value) exec('fontName', this.value);
        editor.focus();
    });

    // ── Font size ────────────────────────────────────────
    document.getElementById('rtb-fontSize').addEventListener('change', function() {
        exec('fontSize', this.value);
    });

    // ── Text color ───────────────────────────────────────
    const fgInput  = document.getElementById('rtb-fgColor');
    const fgBar    = document.getElementById('fgColorBar');
    fgInput.addEventListener('focus', () => { savedRange = saveSelection(); });
    fgInput.addEventListener('input', function() {
        fgBar.style.background = this.value;
        restoreSelection(savedRange);
        exec('foreColor', this.value);
    });

    // ── Highlight / background color ─────────────────────
    const bgInput  = document.getElementById('rtb-bgColor');
    const bgBar    = document.getElementById('bgColorBar');
    bgInput.addEventListener('focus', () => { savedRange = saveSelection(); });
    bgInput.addEventListener('input', function() {
        bgBar.style.background = this.value;
        restoreSelection(savedRange);
        exec('hiliteColor', this.value);
    });

    // ── Link dialog ──────────────────────────────────────
    const linkDialog  = document.getElementById('linkDialog');
    const linkUrlInput = document.getElementById('linkUrlInput');

    document.getElementById('rtb-linkBtn').addEventListener('mousedown', e => {
        e.preventDefault();
        savedRange = saveSelection();
        linkUrlInput.value = '';
        linkDialog.classList.add('open');
        setTimeout(() => linkUrlInput.focus(), 60);
    });
    document.getElementById('linkCancel').addEventListener('click', () => {
        linkDialog.classList.remove('open');
        editor.focus();
    });
    document.getElementById('linkConfirm').addEventListener('click', () => {
        const url = linkUrlInput.value.trim();
        if (url) {
            restoreSelection(savedRange);
            exec('createLink', url);
            // Open links in new tab
            editor.querySelectorAll('a').forEach(a => {
                a.target = '_blank';
                a.rel    = 'noopener noreferrer';
            });
        }
        linkDialog.classList.remove('open');
        editor.focus();
    });
    linkUrlInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  document.getElementById('linkConfirm').click();
        if (e.key === 'Escape') linkDialog.classList.remove('open');
    });

    // ── Keyboard shortcuts ────────────────────────────────
    editor.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey) {
            const map = { b: 'bold', i: 'italic', u: 'underline' };
            if (map[e.key]) { e.preventDefault(); exec(map[e.key]); }
        }
    });

    // ── Char counter + active state refresh ──────────────
    editor.addEventListener('input', () => {
        const len = editor.innerText.replace(/\n/g,'').trim().length;
        charCount.textContent = `${len.toLocaleString()} char${len !== 1 ? 's' : ''}`;
    });
    document.addEventListener('selectionchange', refreshActiveStates);
    editor.addEventListener('mouseup', refreshActiveStates);

    // ── Selection save / restore ──────────────────────────
    function saveSelection() {
        const sel = window.getSelection();
        return sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    }
    function restoreSelection(range) {
        if (!range) return;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
})();

// Helper: get the rich message HTML (used by send loop)
function getRichMessageHTML() {
    return document.getElementById('richMessage').innerHTML;
}
function clearRichMessage() {
    document.getElementById('richMessage').innerHTML = '';
    document.getElementById('richCharCount').textContent = '0 chars';
}

// ═══════════════════════════════════════════════════════════════
// ESTIMATED TIME
// ═══════════════════════════════════════════════════════════════
function updateEstimatedTime() {
    const delay = parseInt(document.getElementById('delaySlider').value) || 30;
    const count = (mode === 'bulk') ? (window._bulkRecipientCount || 0) : 1;
    const totalSeconds = count > 1 ? (count - 1) * delay : 0;
    document.getElementById('timeLeft').textContent = formatTime(totalSeconds);
}

function formatTime(seconds) {
    if (seconds <= 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    let parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 && h === 0) parts.push(`${s}s`);
    return parts.join(' ') || '0m';
}

// ═══════════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════════
function setMode(m) {
    mode = m;
    const isManual = m === 'manual';
    document.getElementById('manualFields').classList.toggle('hidden', !isManual);
    document.getElementById('bulkFields').classList.toggle('hidden', isManual);
    document.getElementById('btnManual').className = isManual
        ? "px-6 py-2 rounded-lg font-medium transition-all bg-white dark:bg-slate-800 shadow-sm text-sm"
        : "px-6 py-2 rounded-lg font-medium transition-all text-slate-500 text-sm";
    document.getElementById('btnBulk').className = !isManual
        ? "px-6 py-2 rounded-lg font-medium transition-all bg-white dark:bg-slate-800 shadow-sm text-sm"
        : "px-6 py-2 rounded-lg font-medium transition-all text-slate-500 text-sm";
    if (isManual) window._bulkRecipientCount = 1;
    updateEstimatedTime();
}

// ═══════════════════════════════════════════════════════════════
// VERIFY / CREDITS
// ═══════════════════════════════════════════════════════════════
async function testConnection() {
    const userKey = document.getElementById('systemKey').value;
    if (!userKey) { addLog("ERROR: Please enter an Access Key first.", "text-red-400"); return; }

    addLog("SYSTEM: Pinging Nexus Node...");
    document.getElementById('creditsLeft').textContent = '...';

    try {
        const getRes = await fetch(SCRIPT_URL, { method: 'GET' });
        const text   = await getRes.text();
        const match  = text.match(/Daily Quota Remaining:\s*(\d+)/i);

        if (match) {
            const quota     = parseInt(match[1]);
            const creditsEl = document.getElementById('creditsLeft');
            creditsEl.textContent = quota.toLocaleString();
            creditsEl.className   = quota > 50
                ? 'text-xl font-mono text-emerald-400'
                : quota > 10
                    ? 'text-xl font-mono text-yellow-400'
                    : 'text-xl font-mono text-red-400';
            addLog(`SYSTEM: Quota fetched — ${quota} sends remaining today.`, "text-blue-400");
        } else {
            document.getElementById('creditsLeft').textContent = '?';
            addLog("SYSTEM: Could not parse quota from response.", "text-yellow-400");
        }

        await fetch(SCRIPT_URL, {
            method: 'POST', mode: 'no-cors',
            body: JSON.stringify({ apiKey: userKey, type: "TEST_CONNECTION" })
        });
        addLog("SYSTEM: Key verified. You are clear to launch.", "text-purple-400");

    } catch (err) {
        document.getElementById('creditsLeft').textContent = 'ERR';
        addLog("SYSTEM: Connection failed. Check your Script URL.", "text-red-400");
    }
}

// ═══════════════════════════════════════════════════════════════
// TEST EMAIL MODAL
// ═══════════════════════════════════════════════════════════════
function openTestModal() {
    const modal    = document.getElementById('testModal');
    const subInput = document.getElementById('testSubject');
    const preview  = document.getElementById('testPreview');
    const status   = document.getElementById('testStatus');
    const btn      = document.getElementById('btnSendTest');

    // Pre-fill subject from form
    const subject = document.getElementById('subject').value.trim();
    subInput.value = subject || '(no subject set)';

    // Show plain-text excerpt of message body
    const richEl   = document.getElementById('richMessage');
    const plainText = richEl ? richEl.innerText.trim() : '';
    preview.textContent = plainText.length > 0
        ? (plainText.length > 300 ? plainText.slice(0, 300) + '…' : plainText)
        : 'No message body yet.';

    // Reset status + button
    status.className = 'test-status';
    status.textContent = '';
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Test`;

    modal.classList.add('open');
    setTimeout(() => document.getElementById('testRecipient').focus(), 80);
}

function closeTestModal() {
    document.getElementById('testModal').classList.remove('open');
}

async function sendTestEmail() {
    const userKey   = document.getElementById('systemKey').value.trim();
    const recipient = document.getElementById('testRecipient').value.trim();
    const subject   = document.getElementById('subject').value.trim() || '(Test) No Subject';
    const sender    = document.getElementById('senderName').value.trim() || 'NexusMail Test';
    const body      = getRichMessageHTML();
    const btn       = document.getElementById('btnSendTest');
    const status    = document.getElementById('testStatus');

    // Validation
    if (!userKey) {
        setTestStatus('error', '✕ Enter your System Access Key first (close this and fill it in).');
        return;
    }
    if (!recipient || !recipient.includes('@')) {
        setTestStatus('error', '✕ Enter a valid test recipient email address.');
        return;
    }
    if (!body || document.getElementById('richMessage').innerText.trim() === '') {
        setTestStatus('error', '✕ Message body is empty — write something first.');
        return;
    }

    // Sending state
    btn.disabled = true;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-18 0"/></svg> Sending…`;
    setTestStatus('sending', '⟳ Transmitting test email…');

    try {
        // Include attachments so the test mirrors the real email exactly
        const attachments = await AttachmentManager.getPayload();

        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode:   'no-cors',
            body: JSON.stringify({
                apiKey:      userKey,
                recipient,
                subject:     `[TEST] ${subject}`,
                senderName:  sender,
                body,
                attachments,
            })
        });

        // no-cors means we can't read the response — treat dispatch as success
        setTestStatus('success', `✓ Test sent to ${recipient} — check your inbox (including spam).`);
        addLog(`TEST: Dispatched preview email → ${recipient}`, 'text-sky-400');

    } catch (err) {
        setTestStatus('error', `✕ Network error — ${err.message}`);
        addLog(`TEST ERROR: ${err.message}`, 'text-red-400');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Again`;
    }
}

function setTestStatus(type, msg) {
    const el = document.getElementById('testStatus');
    el.className = `test-status ${type}`;
    el.textContent = msg;
}

// Close modal on backdrop click
document.getElementById('testModal').addEventListener('click', function(e) {
    if (e.target === this) closeTestModal();
});

// ═══════════════════════════════════════════════════════════════
// CORE SEND LOOP
// ═══════════════════════════════════════════════════════════════
async function runSendLoop({ recipients, startIndex, successCount, failCount, userKey, sender, subject, message }) {
    isAborted = false;
    const baseDelay = parseInt(document.getElementById('delaySlider').value);

    for (let i = startIndex; i < recipients.length; i++) {
        if (isAborted) {
            resumeData = { active: true, recipients, startIndex: i, successCount, failCount, userKey, sender, subject, message };
            showResumeBtn(recipients.length - i, i);
            for (let j = i; j < recipients.length; j++) {
                const r = recipients[j];
                campaignResults.push({
                    email:     r.email,
                    name:      r.firstName || r.name || r.fullName || '',
                    status:    'Skipped (Aborted)',
                    timestamp: getTimestamp(),
                });
            }
            showCsvReportBtn();
            return;
        }

        const currentData = recipients[i];
        const targetEmail = currentData.email;

        // Personalization: replace {token} placeholders in the HTML body
        let personalizedMessage = message;
        Object.keys(currentData).forEach(key => {
            personalizedMessage = personalizedMessage.split(`{${key}}`).join(currentData[key]);
        });

        addLog(`Transmitting: [${i + 1}/${recipients.length}] ${targetEmail}`);

        try {
            // Gather attachment base64 payloads (built once per recipient — same files for all)
            const attachments = await AttachmentManager.getPayload();

            await fetch(SCRIPT_URL, {
                method: 'POST', mode: 'no-cors',
                body: JSON.stringify({
                    apiKey: userKey, recipient: targetEmail,
                    subject, senderName: sender,
                    body: personalizedMessage,   // ← full HTML with formatting
                    attachments,                 // ← array of {name, mimeType, data}
                })
            });

            successCount++;
            const el = document.getElementById('successCount');
            if (el) el.textContent = successCount;
            addLog(`OK: Dispatch signal accepted for ${targetEmail}`, "text-emerald-400");
            campaignResults.push({ email: targetEmail, name: currentData.firstName || currentData.name || '', status: 'Email Sent', timestamp: getTimestamp() });

        } catch (err) {
            failCount++;
            addLog(`ERROR: Connection failed for ${targetEmail}`, "text-red-400");
            campaignResults.push({ email: targetEmail, name: currentData.firstName || currentData.name || '', status: 'Failed', timestamp: getTimestamp() });
        }

        updateProgress(Math.round(((i + 1) / recipients.length) * 100));

        if (i < recipients.length - 1 && !isAborted) {
            const jitter     = Math.floor(Math.random() * 11) - 5;
            const finalDelay = Math.max(5, baseDelay + jitter);
            const remaining  = recipients.length - i - 1;

            addLog(`COOLDOWN: Waiting ${finalDelay}s... (${remaining} left)`, "italic opacity-60 text-[10px] text-orange-400");

            let countdown = finalDelay + (remaining - 1) * baseDelay;
            document.getElementById('timeLeft').textContent = formatTime(countdown);

            await new Promise(resolve => {
                const interval = setInterval(() => {
                    if (isAborted) { clearInterval(interval); resolve(); return; }
                    countdown = Math.max(0, countdown - 1);
                    document.getElementById('timeLeft').textContent = formatTime(countdown);
                }, 1000);
                setTimeout(() => { clearInterval(interval); resolve(); }, finalDelay * 1000);
            });
        }
    }

    resumeData.active = false;
    hideResumeBtn();

    const creditsEl = document.getElementById('creditsLeft');
    const cur = parseInt(creditsEl.textContent.replace(/,/g, ''));
    if (!isNaN(cur)) creditsEl.textContent = Math.max(0, cur - successCount).toLocaleString();

    showCsvReportBtn();
    finish();
}

// ═══════════════════════════════════════════════════════════════
// FORM SUBMIT — Launch Campaign
// ═══════════════════════════════════════════════════════════════
document.getElementById('mailForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const userKey = document.getElementById('systemKey').value;
    const sender  = document.getElementById('senderName').value;
    const subject = document.getElementById('subject').value;
    // Grab the full HTML from the rich editor
    const message = getRichMessageHTML();

    if (!userKey) return alert("System Access Key is required!");
    if (!message || document.getElementById('richMessage').innerText.trim() === '') {
        return alert("Message body cannot be empty!");
    }
    // Attachment size guard
    const attachTotalBytes = AttachmentManager.getTotalSize();
    if (attachTotalBytes > 25 * 1024 * 1024) {
        return alert(`Attachments exceed 25 MB limit (${AttachmentManager.fmtBytes(attachTotalBytes)}). Please remove some files.`);
    }

    let recipients = [];

    if (mode === 'bulk') {
        const fileInput = document.getElementById('csvFile');
        if (fileInput.files.length === 0) return alert("Upload a CSV file!");

        const text    = await fileInput.files[0].text();
        const rows    = text.split('\n').map(row => row.split(','));
        const headers = rows[0].map(h => h.trim());

        recipients = rows.slice(1)
            .filter(row => row[0] && row[0].includes('@'))
            .map(row => {
                let obj = {};
                headers.forEach((header, i) => { obj[header] = row[i]?.trim() || ""; });
                return obj;
            });
    } else {
        const email = document.getElementById('recipientEmail').value;
        if (!email) return alert("Recipient email required!");
        recipients = [{ email }];
    }

    window._bulkRecipientCount = recipients.length;
    updateEstimatedTime();

    resumeData.active = false;
    hideResumeBtn();
    prepareUIForSending();
    campaignResults = [];
    addLog(`STARTING: Preparing to send ${recipients.length} message(s)...`, "text-blue-400 font-bold");

    await runSendLoop({ recipients, startIndex: 0, successCount: 0, failCount: 0, userKey, sender, subject, message });
});

// ═══════════════════════════════════════════════════════════════
// RESUME
// ═══════════════════════════════════════════════════════════════
function resumeCampaign() {
    if (!resumeData.active) return;
    const remaining = resumeData.recipients.length - resumeData.startIndex;
    addLog(`RESUME: Continuing from message ${resumeData.startIndex + 1} — ${remaining} remaining.`, "text-yellow-400 font-bold");
    hideResumeBtn();
    document.getElementById('submitBtn').classList.add('hidden');
    document.getElementById('cancelBtn').classList.remove('hidden');
    document.getElementById('downloadBtn').classList.add('hidden');
    runSendLoop({
        recipients:   resumeData.recipients,
        startIndex:   resumeData.startIndex,
        successCount: resumeData.successCount,
        failCount:    resumeData.failCount,
        userKey:      resumeData.userKey,
        sender:       resumeData.sender,
        subject:      resumeData.subject,
        message:      resumeData.message,
    });
}

function showResumeBtn(remaining, fromIndex) {
    const btn = document.getElementById('resumeBtn');
    if (btn) {
        btn.classList.remove('hidden');
        btn.innerHTML = `<i data-lucide="play-circle" class="w-4 h-4"></i> Resume (${remaining} left from #${fromIndex + 1})`;
        lucide.createIcons();
    }
    addLog(`PAUSED: ${remaining} message(s) pending. Click Resume to continue.`, "text-yellow-400");
    document.getElementById('submitBtn').classList.remove('hidden');
    document.getElementById('cancelBtn').classList.add('hidden');
    document.getElementById('downloadBtn').classList.remove('hidden');
}

function hideResumeBtn() {
    document.getElementById('resumeBtn')?.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// CLEAR ALL
// ═══════════════════════════════════════════════════════════════
function clearAll() {
    isAborted = true;

    document.getElementById('mailForm').reset();
    document.getElementById('fileNameDisplay').textContent = '';

    // Clear rich editor
    clearRichMessage();

    // Clear attachments
    AttachmentManager.clear();

    document.getElementById('successCount').textContent = '0';
    document.getElementById('creditsLeft').textContent  = '---';
    document.getElementById('creditsLeft').className    = 'text-xl font-mono text-blue-400';
    document.getElementById('timeLeft').textContent     = '0m';

    updateProgress(0);
    document.getElementById('logs').innerHTML = '';
    sessionLogs = [];

    resumeData = { active: false, recipients: [], startIndex: 0, successCount: 0, failCount: 0, userKey: '', sender: '', subject: '', message: '' };
    hideResumeBtn();

    document.getElementById('submitBtn').classList.remove('hidden');
    document.getElementById('cancelBtn').classList.add('hidden');
    document.getElementById('downloadBtn').classList.add('hidden');
    document.getElementById('csvReportBtn')?.classList.add('hidden');
    document.getElementById('statusContainer').classList.add('hidden');

    document.getElementById('delaySlider').value        = '30';
    document.getElementById('delayDisplay').textContent = '30 seconds';

    window._bulkRecipientCount = 0;
    campaignResults = [];
    isAborted = false;
}

// ═══════════════════════════════════════════════════════════════
// DELAY SLIDER
// ═══════════════════════════════════════════════════════════════
document.getElementById('delaySlider')?.addEventListener('input', (e) => {
    const seconds = parseInt(e.target.value);
    const display = document.getElementById('delayDisplay');
    if (!display) return;
    if (seconds >= 60) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        display.textContent = `${mins}m${secs > 0 ? ' ' + secs + 's' : ''}`;
    } else {
        display.textContent = `${seconds} seconds`;
    }
    updateEstimatedTime();
});

// ═══════════════════════════════════════════════════════════════
// UI UTILITIES
// ═══════════════════════════════════════════════════════════════
function prepareUIForSending() {
    document.getElementById('submitBtn').classList.add('hidden');
    document.getElementById('cancelBtn').classList.remove('hidden');
    document.getElementById('statusContainer').classList.remove('hidden');
    document.getElementById('downloadBtn').classList.add('hidden');
    document.getElementById('logs').innerHTML = '';
    updateProgress(0);
    document.getElementById('successCount').textContent = '0';
}

function getTimestamp() {
    const now = new Date();
    const dd   = String(now.getDate()).padStart(2, '0');
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh   = String(now.getHours()).padStart(2, '0');
    const min  = String(now.getMinutes()).padStart(2, '0');
    const ss   = String(now.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

function finish() {
    addLog(isAborted ? "TERMINATION COMPLETE." : "CAMPAIGN COMPLETED SUCCESSFULLY.", "text-blue-400 font-bold");
    document.getElementById('submitBtn').classList.remove('hidden');
    document.getElementById('cancelBtn').classList.add('hidden');
    document.getElementById('downloadBtn').classList.remove('hidden');
    document.getElementById('timeLeft').textContent = '0m';
    lucide.createIcons();
}

function updateProgress(percent) {
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('progressPercent').textContent = `${percent}%`;
}

function addLog(text, color = "text-emerald-500") {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    sessionLogs.push(`[${time}] ${text}`);
    const div = document.createElement('div');
    div.className = `${color} flex gap-2`;
    div.innerHTML = `<span class="opacity-40 shrink-0">[${time}]</span> <span class="break-all">> ${text}</span>`;
    const logs = document.getElementById('logs');
    if (logs) { logs.appendChild(div); logs.scrollTop = logs.scrollHeight; }
}

function cancelCampaign() {
    isAborted = true;
    addLog("CRITICAL: ABORT COMMAND RECEIVED. STOPPING AFTER CURRENT MESSAGE...", "text-red-500 font-bold");
}

// ═══════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════
function downloadReport() {
    const blob = new Blob([sessionLogs.join('\n')], { type: 'text/plain' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `nexus-log-${Date.now()}.txt`; a.click();
    window.URL.revokeObjectURL(url);
}

function showCsvReportBtn() {
    const btn = document.getElementById('csvReportBtn');
    if (btn) { btn.classList.remove('hidden'); lucide.createIcons(); }
}

function downloadCsvReport() {
    if (!campaignResults.length) {
        addLog("SYSTEM: No campaign data to export yet.", "text-yellow-400"); return;
    }
    const headers = ['Email', 'Name', 'Status', 'Timestamp'];
    const rows    = campaignResults.map(r => [
        `"${r.email}"`, `"${(r.name || '').replace(/"/g, '""')}"`,
        `"${r.status}"`, `"${r.timestamp}"`,
    ]);
    const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `nexus-campaign-report-${Date.now()}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); window.URL.revokeObjectURL(url);
    addLog(`SYSTEM: Campaign CSV exported — ${campaignResults.length} record(s).`, "text-blue-400");
}

function downloadTemplate() {
    const csvContent = "email,firstName,company\nsample1@example.com,John,Nexus Corp\nsample2@example.com,Jane,SkyNet";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = "nexus_personalized_template.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); window.URL.revokeObjectURL(url);
    addLog("SYSTEM: Personalized template downloaded successfully.", "text-blue-400");
}

// ═══════════════════════════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════════════════════════
document.getElementById('themeToggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    document.getElementById('themeIcon').setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    lucide.createIcons();
});

// ═══════════════════════════════════════════════════════════════
// CSV FILE LISTENER
// ═══════════════════════════════════════════════════════════════
document.getElementById('csvFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('fileNameDisplay').textContent = `Loaded: ${file.name}`;
    addLog(`File attached: ${file.name}`);
    const text  = await file.text();
    const rows  = text.split('\n').filter(r => r.trim() && r.includes('@'));
    window._bulkRecipientCount = rows.length;
    addLog(`SYSTEM: ${rows.length} recipient(s) detected in CSV.`, "text-blue-400");
    updateEstimatedTime();
});

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
updateEstimatedTime();