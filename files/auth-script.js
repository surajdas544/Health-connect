// HealthConnect prototype-only login flow.
// This does NOT authenticate users. Any non-empty email and password can continue.
// Do not use this flow to protect real or sensitive data.

const loginTab = document.querySelector('#loginTab');
const registerTab = document.querySelector('#registerTab');
const loginForm = document.querySelector('#loginForm');
const registerForm = document.querySelector('#registerForm');
const modeSwitch = document.querySelector('.mode-switch');
const formTitle = document.querySelector('#formTitle');
const formSubtitle = document.querySelector('#formSubtitle');
const notice = document.querySelector('#notice');
const DEMO_USER_KEY = 'healthconnectDemoUser';

function showNotice(message, type = 'error') {
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.hidden = false;
}
function clearNotice() {
  notice.hidden = true;
  notice.textContent = '';
  notice.className = 'notice';
}
function setMode(mode) {
  const isLogin = mode === 'login';
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
  modeSwitch.hidden = false;
  loginTab.classList.toggle('active', isLogin);
  registerTab.classList.toggle('active', !isLogin);
  loginTab.setAttribute('aria-selected', String(isLogin));
  registerTab.setAttribute('aria-selected', String(!isLogin));
  formTitle.textContent = isLogin ? 'Welcome back' : 'Create your account';
  formSubtitle.textContent = isLogin
    ? 'Enter any email and password to preview your health workspace.'
    : 'Add a few details to preview your HealthConnect workspace.';
  clearNotice();
}
function getNameFromEmail(email) {
  const rawName = (email.split('@')[0] || 'Demo User')
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, '')
    .trim();
  return rawName.replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Demo User';
}
async function openDashboard({ name, email, role = 'patient' }) {
  // Save/look up the account in the HealthConnect database (server.py).
  // If the server is not running, the app keeps working in local-only prototype mode.
  let token = null;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role })
    });
    if (response.ok) {
      const data = await response.json();
      token = data.token;
      name = data.user.name;
      role = data.user.role;
    }
  } catch (error) { /* database server unavailable */ }

  // Store only display info and the session token; never save the password.
  try {
    sessionStorage.setItem(DEMO_USER_KEY, JSON.stringify({ name, email, role, token }));
  } catch (error) {
    showNotice('Your browser blocked session storage. Please enable it and try again.');
    return;
  }
  window.location.href = 'dashboard.html';
}

loginTab.addEventListener('click', () => setMode('login'));
registerTab.addEventListener('click', () => setMode('register'));
document.querySelector('#switchToRegister').addEventListener('click', () => setMode('register'));
document.querySelector('#switchToLogin').addEventListener('click', () => setMode('login'));

document.querySelectorAll('[data-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.toggle);
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    button.textContent = isHidden ? 'Hide' : 'Show';
    button.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });
});

document.querySelectorAll('.role-option input').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.role-option').forEach((option) => {
      option.classList.toggle('selected', option.querySelector('input').checked);
    });
  });
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = document.querySelector('#loginEmail').value.trim();
  const password = document.querySelector('#loginPassword').value;

  // Prototype rule: accept any non-empty values, with no real verification.
  if (!email || !password) {
    showNotice('Enter any email and password to continue.');
    return;
  }
  openDashboard({ name: getNameFromEmail(email), email, role: 'patient' });
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.querySelector('#fullName').value.trim();
  const email = document.querySelector('#registerEmail').value.trim();
  const password = document.querySelector('#registerPassword').value;
  const confirm = document.querySelector('#confirmPassword').value;
  const terms = document.querySelector('#termsCheck').checked;
  const role = document.querySelector('input[name="role"]:checked')?.value || 'patient';

  if (!name || !email || !password || !confirm) {
    showNotice('Please complete all required fields.');
    return;
  }
  if (password !== confirm) {
    showNotice('Your passwords do not match.');
    return;
  }
  if (!terms) {
    showNotice('Please accept the terms to continue.');
    return;
  }
  openDashboard({ name, email, role });
});

document.querySelector('#forgotBtn').addEventListener('click', () => {
  showNotice('Password reset will be connected when backend authentication is added.', 'success');
});

// Start in sign-in mode.
setMode('login');
