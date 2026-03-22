/**
 * PetFeeder — auth.js
 * Gerencia login, cadastro e sessão do usuário.
 *
 * IMPORTANTE: toda persistência usa localStorage (simulação).
 * Em produção, substitua por chamadas à API real.
 */

/* ================================================================
   UTILITÁRIOS
   ================================================================ */

/** Mostra mensagem de erro/sucesso dentro do auth-card */
function showAuthToast(msg, isError = true) {
  const el = document.getElementById('auth-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.background = isError ? 'rgba(235,87,87,.12)' : 'rgba(39,174,96,.12)';
  el.style.color       = isError ? 'var(--color-danger)' : 'var(--color-success)';
  el.style.borderColor = isError ? 'rgba(235,87,87,.2)'  : 'rgba(39,174,96,.2)';
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3500);
}

/** Carrega usuários do localStorage */
function loadUsers() {
  try {
    return JSON.parse(localStorage.getItem('pf_users') || '[]');
  } catch { return []; }
}

/** Salva usuários no localStorage */
function saveUsers(users) {
  localStorage.setItem('pf_users', JSON.stringify(users));
}

/** Salva sessão ativa (usuário logado) */
function saveSession(username) {
  sessionStorage.setItem('pf_user', username);
}

/* ================================================================
   ALTERNÂNCIA ENTRE VIEWS
   ================================================================ */

function showView(id) {
  document.querySelectorAll('.auth-view').forEach(v => { v.hidden = true; });
  const target = document.getElementById(id);
  if (target) target.hidden = false;
  // Limpa toast
  const toast = document.getElementById('auth-toast');
  if (toast) toast.hidden = true;
}

/* ================================================================
   TOGGLE VISIBILIDADE DE SENHA
   ================================================================ */

function initPasswordToggles() {
  document.querySelectorAll('.toggle-pass-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      // Atualiza ícone
      btn.querySelector('i').className = isText ? 'ph ph-eye' : 'ph ph-eye-slash';
    });
  });
}

/* ================================================================
   LOGIN
   ================================================================ */

function initLogin() {
  const btnLogin = document.getElementById('btn-login');
  if (!btnLogin) return;

  btnLogin.addEventListener('click', () => {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    if (!username || !password) {
      showAuthToast('Preencha usuário e senha.');
      return;
    }

    const users = loadUsers();

    // Verifica conta demo padrão (não precisa ser cadastrada)
    const isDemo = username === 'admin' && password === '1234';

    if (isDemo) {
      // Cria conta demo se não existir
      if (!users.find(u => u.username === 'admin')) {
        users.push({
          username: 'admin',
          password: '1234',
          dogs: [
            { id: 1, name: 'Thor',  weight: 8, age: 3, color: '#2f80ed' },
            { id: 2, name: 'Luna',  weight: 5, age: 2, color: '#9b51e0' },
          ]
        });
        saveUsers(users);
      }
      saveSession('admin');
      window.location.href = 'index.html';
      return;
    }

    // Busca usuário cadastrado
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
      showAuthToast('Usuário ou senha incorretos.');
      return;
    }

    saveSession(username);
    window.location.href = 'index.html';
  });

  // Login ao pressionar Enter
  ['login-user', 'login-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') btnLogin.click(); });
  });
}

/* ================================================================
   CADASTRO — 2 etapas
   ================================================================ */

/** Cor de avatar selecionada no cadastro */
let regSelectedColor = '#2f80ed';

function initRegister() {
  // Navegação entre views
  document.getElementById('go-register')?.addEventListener('click', () => showView('view-register'));
  document.getElementById('go-login')?.addEventListener('click', () => showView('view-login'));

  // Seleção de cor do avatar
  document.querySelectorAll('.avatar-color').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.avatar-color').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      regSelectedColor = btn.dataset.color;
    });
  });

  // ETAPA 1 → ETAPA 2
  document.getElementById('btn-next-step')?.addEventListener('click', () => {
    const username = document.getElementById('reg-user').value.trim();
    const pass     = document.getElementById('reg-pass').value;
    const pass2    = document.getElementById('reg-pass2').value;

    if (!username || username.length < 3) {
      showAuthToast('Usuário deve ter ao menos 3 caracteres.');
      return;
    }
    if (!pass || pass.length < 4) {
      showAuthToast('Senha deve ter ao menos 4 caracteres.');
      return;
    }
    if (pass !== pass2) {
      showAuthToast('As senhas não coincidem.');
      return;
    }

    // Verifica duplicata
    const users = loadUsers();
    if (users.find(u => u.username === username)) {
      showAuthToast('Nome de usuário já cadastrado.');
      return;
    }

    // Avança para etapa 2
    document.getElementById('reg-step-1').hidden = true;
    document.getElementById('reg-step-2').hidden = false;

    // Atualiza indicador de passos
    document.querySelector('.step[data-step="1"]')?.classList.remove('active');
    document.querySelector('.step[data-step="2"]')?.classList.add('active');
  });

  // Voltar para etapa 1
  document.getElementById('btn-back-step')?.addEventListener('click', () => {
    document.getElementById('reg-step-2').hidden = true;
    document.getElementById('reg-step-1').hidden = false;
    document.querySelector('.step[data-step="2"]')?.classList.remove('active');
    document.querySelector('.step[data-step="1"]')?.classList.add('active');
  });

  // FINALIZAR CADASTRO
  document.getElementById('btn-register')?.addEventListener('click', () => {
    const dogName   = document.getElementById('reg-dog-name').value.trim();
    const dogWeight = parseFloat(document.getElementById('reg-dog-weight').value) || null;
    const dogAge    = parseInt(document.getElementById('reg-dog-age').value) || null;

    if (!dogName) {
      showAuthToast('Informe o nome do cachorro.');
      return;
    }

    const username = document.getElementById('reg-user').value.trim();
    const password = document.getElementById('reg-pass').value;

    const newUser = {
      username,
      password,
      dogs: [
        {
          id: Date.now(),
          name: dogName,
          weight: dogWeight,
          age: dogAge,
          color: regSelectedColor,
        }
      ]
    };

    const users = loadUsers();
    users.push(newUser);
    saveUsers(users);

    showAuthToast('Conta criada com sucesso! Fazendo login...', false);

    setTimeout(() => {
      saveSession(username);
      window.location.href = 'index.html';
    }, 1200);
  });
}

/* ================================================================
   INICIALIZAÇÃO
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Se já estiver logado, redireciona direto
  if (sessionStorage.getItem('pf_user')) {
    window.location.href = 'index.html';
    return;
  }

  initPasswordToggles();
  initLogin();
  initRegister();
});
