/* HealthConnect patient dashboard demo.
   All data here is fictional and stored only in this browser. This is not secure medical-record storage. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = 'healthconnect_patient_demo_v1';
const DEMO_USER_KEY = 'healthconnectDemoUser';
let activeDemoUser = null;

const initialState = {
  requests: [
    { id: 'req1', name: 'Dr. Neel Kapoor', initials: 'NK', facility: 'Northside Medical Centre', detail: 'Requests access to selected medical records', when: '2 hours ago', status: 'pending', tone: 'purple' },
    { id: 'req2', name: 'Dr. Simran Patel', initials: 'SP', facility: 'WellSpring Diagnostics', detail: 'Requests access to blood test report', when: 'Yesterday', status: 'pending', tone: 'coral' }
  ],
  appointments: [],
  reports: [],
  approved: [
    { id: 'doc1', name: 'Dr. Ananya Mehta', initials: 'AM', access: 'Selected records', lastAccess: '14 Oct 2026, 11:20 AM', status: 'approved' }
  ],
  rejected: []
};
let state = loadState();
let selectedFileUrl = null;

const workspaceInfo = {
  overview: { title: 'Welcome back', description: 'Here is your personal health overview and quick access to each workspace.' },
  'patient-details': { title: 'Patient details', description: 'Review your profile and essential health information.' },
  appointments: { title: 'Appointments', description: 'Review upcoming visits and appointment details.' },
  reports: { title: 'Medical reports', description: 'View and organise reports and documents.' },
  'care-plan': { title: 'Precautions & medicines', description: 'Review care notes and medicine records saved in this demo.' },
  doctors: { title: 'Appointed doctors', description: 'See the healthcare professionals listed in your care team.' },
  access: { title: 'Doctor access requests', description: 'Review requests and choose which demo doctors may view records.' },
  'access-history': { title: 'Doctor access history', description: 'Review the demo history of sharing decisions and access status.' }
};

function navigateToWorkspace(sectionName) {
  if (sectionName === 'settings') {
    toast('Settings', 'Profile settings will be added in a later version.');
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(workspaceInfo, sectionName)) return;

  const isOverview = sectionName === 'overview';
  const main = $('.main-content');
  main.classList.toggle('view-overview', isOverview);
  main.classList.toggle('view-workspace', !isOverview);
  $('#workspacePanels').classList.toggle('single-workspace', !isOverview);
  $('#workspaceHeader').setAttribute('aria-hidden', String(isOverview));
  $('#workspaceTitle').textContent = workspaceInfo[sectionName].title;
  $('#workspaceDescription').textContent = workspaceInfo[sectionName].description;
  $('#crumbCurrent').textContent = isOverview ? 'Overview' : workspaceInfo[sectionName].title;

  $$('.workspace-panel').forEach(panel => {
    const active = !isOverview && panel.id === sectionName;
    panel.classList.toggle('active-workspace-panel', active);
    panel.setAttribute('aria-hidden', String(!active));
  });
  $$('.nav-link[data-section]').forEach(link => {
    link.classList.toggle('active', link.dataset.section === sectionName);
    if (link.dataset.section === sectionName) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#sidebar').classList.remove('sidebar-open');

  // Each workspace starts near the top so the user sees only the selected content.
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(initialState);
    const parsed = JSON.parse(saved);
    return { ...structuredClone(initialState), ...parsed };
  } catch (error) {
    console.warn('Could not restore demo state:', error);
    return structuredClone(initialState);
  }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (error) { toast('Browser storage is full', 'Some demo changes may not remain after refresh.'); }
  pushState();
}

/* ---- HealthConnect database sync (server.py) ---- */
let dbWarned = false;
function dbHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${activeDemoUser.token}` };
}
function dbUnavailable() {
  if (dbWarned) return;
  dbWarned = true;
  toast('Database unreachable', 'Changes are kept in this browser only.');
}
async function pushState() {
  if (!activeDemoUser?.token) return;
  try {
    const response = await fetch('/api/state', { method: 'PUT', headers: dbHeaders(), body: JSON.stringify({ state }), keepalive: true });
    if (!response.ok) dbUnavailable();
  } catch (error) { dbUnavailable(); }
}
// Returns false if the session is no longer valid and we are redirecting to sign-in.
async function pullState() {
  if (!activeDemoUser?.token) return true;
  try {
    const response = await fetch('/api/state', { headers: dbHeaders() });
    if (response.status === 401) {
      try { sessionStorage.removeItem(DEMO_USER_KEY); } catch (error) { /* no-op */ }
      window.location.replace('index.html');
      return false;
    }
    if (!response.ok) { dbUnavailable(); return true; }
    const data = await response.json();
    if (data.state) {
      state = { ...structuredClone(initialState), ...data.state };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* no-op */ }
    } else {
      // First visit for this account: start from the defaults and store them in the database.
      state = structuredClone(initialState);
      saveState();
    }
  } catch (error) { dbUnavailable(); }
  return true;
}
function icon(id) { return `<svg aria-hidden="true"><use href="#i-${id}"></use></svg>`; }
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function toast(title, message = '') {
  const element = document.createElement('div');
  element.className = 'toast';
  element.innerHTML = `${icon('check')}<div><strong>${escapeHTML(title)}</strong>${message ? `<span>${escapeHTML(message)}</span>` : ''}</div>`;
  $('#toastRegion').append(element);
  window.setTimeout(() => element.remove(), 3900);
}

function applyDemoIdentity() {
  try {
    activeDemoUser = JSON.parse(sessionStorage.getItem(DEMO_USER_KEY) || 'null');
  } catch (error) {
    activeDemoUser = null;
  }

  // This is a navigation convenience for the prototype, not a security boundary.
  if (!activeDemoUser || !activeDemoUser.email) {
    window.location.replace('index.html');
    return false;
  }

  const fullName = String(activeDemoUser.name || activeDemoUser.email.split('@')[0] || 'Demo User').trim();
  const firstName = fullName.split(/\s+/)[0] || 'there';
  const roleLabel = activeDemoUser.role === 'doctor' ? 'Doctor demo' : 'Patient demo';
  const initials = fullName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'DU';

  $('#sidebarUserName').textContent = fullName;
  $('#sidebarUserRole').textContent = roleLabel;
  $('#detailsProfileName').textContent = fullName;
  $('#topUserName').innerHTML = `${escapeHTML(fullName)}<small>${escapeHTML(roleLabel)}</small>`;
  $$('.avatar-patient').forEach(avatar => { avatar.textContent = initials; });
  $('#welcomeHeading').innerHTML = `Welcome, ${escapeHTML(firstName)} <span class="wave">✳</span>`;

  $('#demoLogoutBtn').addEventListener('click', () => {
    if (activeDemoUser?.token) fetch('/api/logout', { method: 'POST', headers: dbHeaders(), keepalive: true }).catch(() => {});
    try { sessionStorage.removeItem(DEMO_USER_KEY); } catch (error) { /* no-op for demo */ }
    window.location.href = 'index.html';
  });
  return true;
}

function updateDate() {
  const date = new Date();
  $('#todayDate').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
function updateCounters() {
  const pending = state.requests.filter(request => request.status === 'pending').length;
  $('#statPending').textContent = String(pending).padStart(2, '0');
  $('#navPendingCount').textContent = pending;
  $('#statDoctors').textContent = String(state.approved.length + 1).padStart(2, '0');
  $('#statReports').textContent = String(12 + state.reports.length).padStart(2, '0');
  $('#statAppointments').textContent = String(2 + state.appointments.length).padStart(2, '0');
  $('#statPendingTag').textContent = pending ? 'Needs review' : 'All reviewed';
  $('#launcherPendingCount').textContent = pending ? `${pending} pending` : 'All reviewed';
  $('#launcherPendingCount').classList.toggle('all-reviewed', pending === 0);
  $('#accessEmpty').classList.toggle('hidden', pending > 0);
  $('#accessRequestList').classList.toggle('hidden', pending === 0);
}
function renderRequests() {
  const list = $('#accessRequestList');
  const pending = state.requests.filter(request => request.status === 'pending');
  if (!pending.length) {
    list.innerHTML = '';
  } else {
    list.innerHTML = pending.map(request => `
      <article class="access-request" data-request-id="${escapeHTML(request.id)}">
        <div class="request-avatar ${request.tone === 'purple' ? 'request-avatar-purple' : 'request-avatar-coral'}">${escapeHTML(request.initials)}</div>
        <div class="request-content">
          <div class="request-title"><strong>${escapeHTML(request.name)}</strong><span class="status-pill status-pending">Pending</span></div>
          <p>${escapeHTML(request.facility)}</p>
          <span class="request-meta">${escapeHTML(request.detail)} · ${escapeHTML(request.when)}</span>
          <div class="request-buttons"><button class="btn btn-primary btn-xs approve-request" data-request-id="${escapeHTML(request.id)}">Allow access</button><button class="btn btn-quiet btn-xs reject-request" data-request-id="${escapeHTML(request.id)}">Decline</button></div>
        </div>
      </article>`).join('');
  }
  updateCounters();
  renderHistory();
}
function renderHistory() {
  const list = $('#accessHistoryList');
  const approved = state.approved.map(doctor => `
    <div class="history-item">
      <span class="history-marker success-marker">${icon('check')}</span>
      <div class="history-copy"><strong>${escapeHTML(doctor.name)}</strong><span>Access approved · ${escapeHTML(doctor.access || 'Selected records')}</span><small>Last accessed: ${escapeHTML(doctor.lastAccess || 'Not yet accessed in demo')}</small></div>
      <button class="revoke-btn" data-doctor-id="${escapeHTML(doctor.id)}">Revoke</button>
    </div>`);
  const recentlyRejected = state.rejected.slice(-2).reverse().map(doctor => `
    <div class="history-item"><span class="history-marker neutral-marker">${icon('x')}</span><div class="history-copy"><strong>${escapeHTML(doctor.name)}</strong><span>Request declined</span><small>Access not granted</small></div><span class="history-status">Declined</span></div>`);
  if (!approved.length && !recentlyRejected.length) {
    list.innerHTML = `<div class="empty-state">${icon('shield')}<strong>No access activity yet</strong>When you review a request, it will appear here.</div>`;
  } else {
    list.innerHTML = [...approved, ...recentlyRejected].join('');
  }
}
function renderReports() {
  if (!state.reports.length) return;
  const tbody = $('#reportsTableBody');
  // Rebuild only locally-added demo rows so repeated uploads do not duplicate them.
  $$('tr[data-uploaded-demo="true"]', tbody).forEach(row => row.remove());
  const rows = state.reports.map((report, index) => `
    <tr data-uploaded-demo="true" data-searchable="${escapeHTML((report.name + ' ' + report.fileName + ' ' + report.type).toLowerCase())}">
      <td><div class="report-name"><span class="file-icon ${report.type === 'PDF' ? 'pdf-file' : 'img-file'}">${escapeHTML(report.type)}</span><span><strong>${escapeHTML(report.name)}</strong><small>${escapeHTML(report.fileName)}</small></span></div></td>
      <td>${escapeHTML(report.date)}</td><td><span class="report-type">${escapeHTML(report.category || 'Uploaded')}</span></td>
      <td><button class="row-menu uploaded-report-view" data-report-index="${index}" aria-label="View uploaded report">↗</button></td>
    </tr>`).join('');
  tbody.innerHTML = rows + tbody.innerHTML;
  $('#reportFooterText').innerHTML = `Showing ${3 + state.reports.length} recent reports <span class="demo-label">LOCAL DEMO</span>`;
  updateCounters();
}
function renderAppointments() {
  if (!state.appointments.length) return;
  const list = $('#appointmentList');
  const rows = state.appointments.map(appointment => `
    <article class="appointment-item"><div class="appointment-date"><strong>${escapeHTML(appointment.day)}</strong><span>${escapeHTML(appointment.month)}</span></div><div class="appointment-main"><div class="appointment-title-row"><h3>${escapeHTML(appointment.doctor)}</h3><span class="status-pill status-confirmed">Demo booking</span></div><p>${escapeHTML(appointment.specialty)} <span>•</span> Consultation</p><div class="appointment-meta"><span>${icon('clock')} ${escapeHTML(appointment.time)}</span><span>${icon('location')} ${escapeHTML(appointment.type)}</span></div></div><div class="doctor-mini-avatar doctor-1">${escapeHTML(appointment.initials)}</div></article>`).join('');
  list.insertAdjacentHTML('afterbegin', rows);
  updateCounters();
}
function approveRequest(id) {
  const request = state.requests.find(item => item.id === id && item.status === 'pending');
  if (!request) return;
  request.status = 'approved';
  state.approved.push({ id: `approved-${request.id}`, name: request.name, initials: request.initials, access: 'Selected records', lastAccess: 'Access granted just now', status: 'approved' });
  saveState(); renderRequests();
  toast('Access approved', `${request.name} is listed as approved in this local demo. No real records were shared.`);
}
function rejectRequest(id) {
  const request = state.requests.find(item => item.id === id && item.status === 'pending');
  if (!request) return;
  request.status = 'rejected';
  state.rejected.push({ id: request.id, name: request.name, initials: request.initials });
  saveState(); renderRequests();
  toast('Request declined', `${request.name}'s demo request was declined.`);
}
function revokeAccess(id) {
  const doctor = state.approved.find(item => item.id === id);
  if (!doctor) return;
  const confirmed = window.confirm(`Revoke demo access for ${doctor.name}?`);
  if (!confirmed) return;
  state.approved = state.approved.filter(item => item.id !== id);
  saveState(); renderHistory(); updateCounters();
  toast('Access revoked in demo', `${doctor.name} has been removed from your approved list. Backend enforcement is not connected.`);
}
function showModal(title, kicker, bodyHTML, afterRender) {
  $('#modalTitle').textContent = title;
  $('#modalKicker').textContent = kicker;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modalBackdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (typeof afterRender === 'function') afterRender();
  $('#closeModalBtn').focus();
}
function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
  document.body.style.overflow = '';
}
function openAppointmentModal() {
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  showModal('Book an appointment', 'APPOINTMENTS', `
    <form class="modal-form" id="appointmentForm">
      <div class="form-field"><label for="appointmentDoctor">Doctor</label><select id="appointmentDoctor" required><option value="">Choose a doctor</option><option>Dr. Ananya Mehta</option><option>Dr. Rohan Desai</option><option>Dr. Neel Kapoor</option></select></div>
      <div class="form-field"><label for="appointmentSpecialty">Specialty</label><select id="appointmentSpecialty" required><option>General physician</option><option>Cardiologist</option><option>Dermatologist</option><option>Other consultation</option></select></div>
      <div class="form-grid"><div class="form-field"><label for="appointmentDate">Preferred date</label><input id="appointmentDate" type="date" min="${minDate}" required /></div><div class="form-field"><label for="appointmentTime">Preferred time</label><select id="appointmentTime" required><option>10:00 AM</option><option>10:30 AM</option><option>12:00 PM</option><option>02:30 PM</option><option>04:00 PM</option></select></div></div>
      <div class="form-field"><label for="appointmentType">Consultation type</label><select id="appointmentType"><option>CityCare Clinic</option><option>Online consultation</option></select></div>
      <div class="modal-note">Frontend demo only: this form adds a local sample appointment. It does not contact a real clinic or confirm a real booking.</div>
      <div class="modal-actions"><button type="button" class="btn btn-quiet" id="cancelAppointmentBtn">Cancel</button><button type="submit" class="btn btn-primary">Add demo appointment</button></div>
    </form>`);
  $('#appointmentForm').addEventListener('submit', event => {
    event.preventDefault();
    const doctor = $('#appointmentDoctor').value;
    const dateValue = $('#appointmentDate').value;
    if (!doctor || !dateValue) return;
    const date = new Date(`${dateValue}T12:00:00`);
    const initials = doctor.split(' ').filter(word => word && word !== 'Dr.').map(word => word[0]).slice(0, 2).join('').toUpperCase();
    state.appointments.push({ doctor, date: dateValue, day: String(date.getDate()).padStart(2, '0'), month: date.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(), specialty: $('#appointmentSpecialty').value, time: $('#appointmentTime').value, type: $('#appointmentType').value, initials });
    saveState();
    // Rebuild the dynamic portion from the baseline once, then add all local appointments.
    const existingLocal = $$('.appointment-item[data-local-appointment="true"]');
    existingLocal.forEach(item => item.remove());
    state.appointments.forEach(appointment => {
      const article = document.createElement('article');
      article.className = 'appointment-item'; article.dataset.localAppointment = 'true';
      article.innerHTML = `<div class="appointment-date"><strong>${escapeHTML(appointment.day)}</strong><span>${escapeHTML(appointment.month)}</span></div><div class="appointment-main"><div class="appointment-title-row"><h3>${escapeHTML(appointment.doctor)}</h3><span class="status-pill status-confirmed">Demo booking</span></div><p>${escapeHTML(appointment.specialty)} <span>•</span> Consultation</p><div class="appointment-meta"><span>${icon('clock')} ${escapeHTML(appointment.time)}</span><span>${icon('location')} ${escapeHTML(appointment.type)}</span></div></div><div class="doctor-mini-avatar doctor-1">${escapeHTML(appointment.initials)}</div>`;
      $('#appointmentList').append(article);
    });
    updateCounters(); closeModal(); toast('Demo appointment added', `Added ${doctor} to your dashboard.`);
  });
  $('#cancelAppointmentBtn').addEventListener('click', closeModal);
}
function openProfileModal() {
  showModal('Patient profile', 'YOUR DETAILS', `
    <div class="patient-profile-head" style="padding:0 0 17px"><div class="profile-avatar avatar-patient large-avatar">${escapeHTML((activeDemoUser?.name || 'Demo User').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())}</div><div><h3>${escapeHTML(activeDemoUser?.name || 'Demo User')}</h3><p>Prototype account</p><span class="profile-verified">${icon('shield')} Demo patient profile</span></div></div>
    <div class="profile-summary"><div class="summary-cell"><span>DATE OF BIRTH</span><strong>12 March 1998</strong></div><div class="summary-cell"><span>BLOOD GROUP</span><strong>O positive</strong></div><div class="summary-cell"><span>PHONE</span><strong>+91 98••• ••210</strong></div><div class="summary-cell"><span>EMERGENCY CONTACT</span><strong>On file</strong></div><div class="summary-cell"><span>ALLERGIES</span><strong>Not provided in demo</strong></div><div class="summary-cell"><span>RECORD SHARING</span><strong>Permission-based demo</strong></div></div>
    <div class="modal-note" style="margin-top:15px">These are fictional example details for the UI prototype. Connect an authenticated backend before handling real patient information.</div>
    <div class="modal-actions" style="margin-top:16px"><button class="btn btn-primary" id="profileDoneBtn">Done</button></div>`);
  $('#profileDoneBtn').addEventListener('click', closeModal);
}
function openRecordModal(reportName, reportMeta = 'Example record') {
  showModal(reportName, 'MEDICAL RECORD', `<div class="modal-note">${escapeHTML(reportMeta)}</div><div style="padding:18px 0 4px;text-align:center;color:#81948c">${icon('file')}<p style="font-size:12px;color:#486157;font-weight:700">Preview is not connected</p><p style="font-size:10px;line-height:1.6">This frontend prototype lists example report names only. Uploading a real file to secure storage will be implemented in the backend phase.</p></div><div class="modal-actions"><button class="btn btn-primary" id="recordCloseBtn">Close</button></div>`);
  $('#recordCloseBtn').addEventListener('click', closeModal);
}
function openHistoryModal() {
  showModal('Access history', 'PRIVACY & PERMISSIONS', `<div class="modal-note">This list reflects the current browser demo state. It is not a server-side audit log and cannot prove that a real doctor accessed a record.</div><div style="margin-top:14px" id="modalHistoryRows"></div><div class="modal-actions" style="margin-top:16px"><button class="btn btn-primary" id="historyDoneBtn">Done</button></div>`, () => {
    const rows = [...state.approved.map(item => ({ name: item.name, status: 'Approved', detail: item.access || 'Selected records' })), ...state.rejected.map(item => ({ name: item.name, status: 'Declined', detail: 'Request not approved' })), ...state.requests.filter(item => item.status === 'pending').map(item => ({ name: item.name, status: 'Pending', detail: item.detail }))];
    $('#modalHistoryRows').innerHTML = rows.length ? rows.map(row => `<div class="history-item"><span class="history-marker ${row.status === 'Approved' ? 'success-marker' : 'neutral-marker'}">${icon(row.status === 'Approved' ? 'check' : 'shield')}</span><div class="history-copy"><strong>${escapeHTML(row.name)}</strong><span>${escapeHTML(row.detail)}</span></div><span class="history-status">${escapeHTML(row.status)}</span></div>`).join('') : '<div class="empty-state">No access activity yet.</div>';
  });
  $('#historyDoneBtn').addEventListener('click', closeModal);
}
function setupNavigation() {
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-section]');
    if (!trigger) return;
    const sectionName = trigger.dataset.section;
    if (Object.prototype.hasOwnProperty.call(workspaceInfo, sectionName) || sectionName === 'settings') {
      event.preventDefault();
      navigateToWorkspace(sectionName);
    }
  });

  $('#mobileMenuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('sidebar-open'));
  document.addEventListener('click', event => {
    if (window.innerWidth <= 980 && !$('#sidebar').contains(event.target) && !$('#mobileMenuBtn').contains(event.target)) {
      $('#sidebar').classList.remove('sidebar-open');
    }
  });

  // Overview is the first screen; workspace panels remain hidden until selected.
  navigateToWorkspace('overview');
}
function setupSearch() {
  $('#globalSearch').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    const targets = $$('.appointment-item, .doctor-row, .access-request, .history-item, #reportsTableBody tr, .detail-item, .medicine-row');
    let visible = 0;
    targets.forEach(item => {
      const match = !query || item.textContent.toLowerCase().includes(query) || (item.dataset.searchable || '').includes(query);
      item.classList.toggle('filtered-out', !match);
      if (match) visible++;
    });
    $$('.panel').forEach(panel => {
      const searchables = $$('.appointment-item, .doctor-row, .access-request, .history-item, #reportsTableBody tr, .detail-item, .medicine-row', panel);
      if (query && searchables.length && !searchables.some(item => !item.classList.contains('filtered-out'))) {
        panel.dataset.searchEmpty = 'true';
      } else delete panel.dataset.searchEmpty;
    });
    if (query && visible === 0) toast('No matches found', 'Try a doctor name, report name, or appointment type.');
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); }
    if (event.key === 'Escape') closeModal();
  });
}
function setupUpload() {
  $('#uploadReportBtn').addEventListener('click', () => $('#reportFileInput').click());
  $('#reportFileInput').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = file.type === 'application/pdf' || file.type.startsWith('image/');
    if (!allowed) { toast('File type not supported', 'Choose a PDF or image file.'); event.target.value = ''; return; }
    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) { toast('File is too large', 'For this UI demo, choose a file smaller than 8 MB.'); event.target.value = ''; return; }
    const date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
    const type = file.type === 'application/pdf' ? 'PDF' : 'IMG';
    const report = { name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()), fileName: file.name, date, type, category: 'Local demo' };
    // File bytes are deliberately not placed in localStorage. This adds only a metadata row.
    state.reports.push(report); saveState(); renderReports();
    if (selectedFileUrl) URL.revokeObjectURL(selectedFileUrl);
    selectedFileUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    const previewText = selectedFileUrl ? 'Image selected; this local preview is not a secure upload.' : 'PDF selected; its contents have not been uploaded to a server.';
    showModal('Report selected', 'LOCAL DEMO', `<div class="modal-note">${escapeHTML(previewText)}</div>${selectedFileUrl ? `<img src="${selectedFileUrl}" alt="Selected report preview" style="display:block;max-width:100%;max-height:330px;object-fit:contain;margin:16px auto;border-radius:8px;border:1px solid #e7eeeb" />` : `<div style="padding:18px;text-align:center;color:#60796e">${icon('file')}<p style="font-weight:700;font-size:12px">${escapeHTML(file.name)}</p><p style="font-size:10px">${(file.size / 1024).toFixed(0)} KB</p></div>`}<div class="modal-note">The filename has been added to this browser demo. The file itself is not stored in secure cloud storage; integrate a private storage bucket for real use.</div><div class="modal-actions" style="margin-top:16px"><button class="btn btn-primary" id="uploadModalDone">Done</button></div>`);
    $('#uploadModalDone').addEventListener('click', closeModal);
    event.target.value = '';
    toast('Report added to demo list', 'Only its filename and details are remembered.');
  });
}
function setupEvents() {
  $('#bookAppointmentBtn').addEventListener('click', openAppointmentModal);
  $('#viewAppointmentsBtn').addEventListener('click', () => { navigateToWorkspace('appointments'); toast('Appointment schedule', 'Your upcoming appointments are shown in this workspace.'); });
  $('#editProfileBtn').addEventListener('click', openProfileModal);
  $('#viewProfileBtn').addEventListener('click', openProfileModal);
  $('#topProfileBtn').addEventListener('click', openProfileModal);
  $('#profileMenuBtn').addEventListener('click', openProfileModal);
  $('#notificationBtn').addEventListener('click', () => { navigateToWorkspace('access'); toast('Notifications', `${state.requests.filter(request => request.status === 'pending').length} pending access request(s) need your review.`); });
  $('#allReportsBtn').addEventListener('click', () => toast('Medical reports', 'The table shows recent demo records and local filenames you add.'));
  $('#medicineInfoBtn').addEventListener('click', () => showModal('Medicines on file', 'CARE PLAN', '<div class="modal-note">Medicine entries here are fictional examples for demonstrating the interface, not personal medical instructions.</div><div class="history-item" style="margin-top:12px"><span class="history-marker success-marker">Rx</span><div class="history-copy"><strong>Vitamin D supplement</strong><span>Example medicine record</span><small>Schedule and dosage: not specified in this demo.</small></div></div><div class="history-item"><span class="history-marker neutral-marker">Rx</span><div class="history-copy"><strong>Medication record 02</strong><span>Example medicine record</span><small>Confirm all medicine details with a qualified clinician.</small></div></div><div class="modal-actions" style="margin-top:16px"><button class="btn btn-primary" id="medicineDoneBtn">Done</button></div>'));
  $('#modalBody').addEventListener('click', event => { if (event.target.id === 'medicineDoneBtn') closeModal(); });
  $('#findDoctorBtn').addEventListener('click', () => toast('Find a doctor', 'A searchable doctor directory can be connected in a later version.'));
  $('#accessHistoryBtn').addEventListener('click', () => navigateToWorkspace('access-history'));
  $('#closeModalBtn').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
  document.addEventListener('click', event => {
    const approve = event.target.closest('.approve-request');
    const reject = event.target.closest('.reject-request');
    const revoke = event.target.closest('.revoke-btn');
    const report = event.target.closest('.report-view-btn');
    const uploadedReport = event.target.closest('.uploaded-report-view');
    const doctor = event.target.closest('.doctor-action');
    if (approve) approveRequest(approve.dataset.requestId);
    if (reject) rejectRequest(reject.dataset.requestId);
    if (revoke) revokeAccess(revoke.dataset.doctorId);
    if (report) openRecordModal(report.dataset.report, 'Fictional report metadata. A secure file preview is not connected yet.');
    if (uploadedReport) {
      const item = state.reports[Number(uploadedReport.dataset.reportIndex)];
      if (item) openRecordModal(item.name, `Local demo filename: ${item.fileName}. File bytes are not retained after this page session.`);
    }
    if (doctor) showModal(doctor.dataset.doctor, 'CARE TEAM', `<div class="modal-note">This is a sample doctor profile in the patient dashboard prototype.</div><div class="profile-summary" style="margin-top:14px"><div class="summary-cell"><span>ROLE</span><strong>${doctor.dataset.doctor.includes('Ananya') ? 'General physician' : doctor.dataset.doctor.includes('Rohan') ? 'Cardiologist' : 'Healthcare professional'}</strong></div><div class="summary-cell"><span>RELATIONSHIP</span><strong>${doctor.dataset.doctor.includes('Ananya') ? 'Appointed in demo' : 'Appointment pending'}</strong></div></div><div class="modal-actions" style="margin-top:16px"><button class="btn btn-primary" id="doctorDoneBtn">Done</button></div>`);
  });
  document.addEventListener('click', event => { if (event.target.id === 'doctorDoneBtn') closeModal(); });
}
async function init() {
  if (!applyDemoIdentity()) return;
  if (!(await pullState())) return;
  updateDate();
  setupNavigation();
  setupSearch();
  setupUpload();
  setupEvents();
  renderRequests();
  renderHistory();
  updateCounters();
  renderReports();
  // Restore appointments entered in this browser during earlier sessions.
  if (state.appointments.length) {
    state.appointments.forEach(appointment => {
      const article = document.createElement('article'); article.className = 'appointment-item'; article.dataset.localAppointment = 'true';
      article.innerHTML = `<div class="appointment-date"><strong>${escapeHTML(appointment.day)}</strong><span>${escapeHTML(appointment.month)}</span></div><div class="appointment-main"><div class="appointment-title-row"><h3>${escapeHTML(appointment.doctor)}</h3><span class="status-pill status-confirmed">Demo booking</span></div><p>${escapeHTML(appointment.specialty)} <span>•</span> Consultation</p><div class="appointment-meta"><span>${icon('clock')} ${escapeHTML(appointment.time)}</span><span>${icon('location')} ${escapeHTML(appointment.type)}</span></div></div><div class="doctor-mini-avatar doctor-1">${escapeHTML(appointment.initials)}</div>`;
      $('#appointmentList').append(article);
    });
  }
}
document.addEventListener('DOMContentLoaded', init);
