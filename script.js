/**
 * PetFeeder — script.js  (v2)
 * App principal: dashboard, alimentação, horários, histórico, dados TCC.
 *
 * Estrutura:
 *  1.  CONFIGURAÇÕES
 *  2.  ESTADO GLOBAL
 *  3.  DADOS MOCKADOS
 *  4.  API ESP32 (simulada)
 *  5.  SESSÃO / AUTH
 *  6.  NAVEGAÇÃO
 *  7.  TOAST
 *  8.  MODAIS
 *  9.  SELEÇÃO DE CACHORRO
 * 10.  DASHBOARD
 * 11.  GRÁFICO GAUGE (reservatório)
 * 12.  CONTROLE MANUAL
 * 13.  HORÁRIOS
 * 14.  HISTÓRICO
 * 15.  DADOS TCC
 * 16.  EXPORTAÇÃO
 * 17.  CONEXÃO ESP32
 * 18.  INICIALIZAÇÃO
 */

/* ================================================================
   1. CONFIGURAÇÕES
   ================================================================ */

const ESP32_BASE_URL        = 'http://192.168.4.1';  // IP do Access Point
const DEFAULT_FEED_GRAMS    = 50;
const MAX_BOWL_CAPACITY_G   = 300;
const STATUS_POLL_INTERVAL  = 0;    // 0 = sem polling automático (manual)

/* ================================================================
   2. ESTADO GLOBAL
   ================================================================ */

const state = {
  // Sessão
  currentUser:     null,   // objeto do usuário logado
  currentDog:      null,   // objeto do cachorro selecionado

  // Hardware
  connected:       false,
  foodGrams:       180,    // gramas no pote (simulado)
  lastFeedTime:    null,   // Date
  feederStatus:    'waiting', // 'full' | 'empty' | 'waiting'

  // UI
  currentPage:     'dashboard',
  selectedQty:     50,
  activeFilter:    'all',

  // Gráfico gauge — só atualiza manualmente
  gaugeChart:      null,
  gaugeNeedsUpdate: false,

  // Gráficos de dados
  consumptionChart: null,
  scheduleChart:    null,
};

/* ================================================================
   3. DADOS MOCKADOS
   ================================================================ */

/**
 * Retorna histórico simulado para um cachorro.
 * Em produção virá do ESP32 via /history?dog_id=X
 */
function getMockHistory(dogId) {
  const bases = [
    { date: '22/03/2025', time: '08:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 4  },
    { date: '22/03/2025', time: '12:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 6  },
    { date: '22/03/2025', time: '18:00', grams: 80,  type: 'manual', status: 'not-consumed', eatMinutes: 0  },
    { date: '21/03/2025', time: '08:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 5  },
    { date: '21/03/2025', time: '12:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 7  },
    { date: '21/03/2025', time: '18:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 3  },
    { date: '20/03/2025', time: '08:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 5  },
    { date: '20/03/2025', time: '18:00', grams: 80,  type: 'manual', status: 'not-consumed', eatMinutes: 0  },
    { date: '19/03/2025', time: '08:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 8  },
    { date: '19/03/2025', time: '18:00', grams: 50,  type: 'auto',   status: 'consumed',     eatMinutes: 4  },
  ];
  // Pequena variação por dog para simular dados diferentes
  return bases.map((h, i) => ({
    ...h,
    id: dogId * 100 + i,
    grams: h.grams + (dogId % 2 === 0 ? 10 : 0),
  }));
}

/**
 * Horários iniciais por cachorro
 */
function getMockSchedules(dogId) {
  return [
    { id: dogId * 10 + 1, time: '08:00', grams: 50, days: ['dom','seg','ter','qua','qui','sex','sab'], enabled: true },
    { id: dogId * 10 + 2, time: '18:00', grams: 80, days: ['dom','seg','ter','qua','qui','sex','sab'], enabled: true },
  ];
}

/**
 * Gera dados diários de consumo para gráfico (7 dias)
 */
function getMockDailyConsumption(dogId) {
  const base = dogId === 1 ? 130 : 100;
  return [105, 130, base + 10, base, base + 20, base - 10, base + 5];
}

/**
 * Labels dos últimos 7 dias
 */
function getLast7DaysLabels() {
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
  }
  return labels;
}

/* ================================================================
   4. API ESP32 (SIMULADA)
   ================================================================
   Para integração real: substitua o corpo de cada função por
   um fetch() apontando para ESP32_BASE_URL.
   ================================================================ */

async function simulateDelay(ms = 150 + Math.random() * 200) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * GET /status
 * Retorna estado atual do hardware.
 */
async function apiGetStatus() {
  await simulateDelay();
  return {
    foodGrams:    state.foodGrams,
    lastFeedTime: state.lastFeedTime,
    feederStatus: state.foodGrams <= 0 ? 'empty'
                : state.foodGrams > MAX_BOWL_CAPACITY_G * 0.8 ? 'full'
                : 'waiting',
  };
}

/**
 * POST /feed  { grams, dogId }
 * Aciona o servo motor para liberar ração.
 */
async function apiFeed(grams, dogId) {
  await simulateDelay(300);

  if (state.foodGrams <= 0) {
    return { success: false, message: 'Pote vazio! Reabasteça a ração.' };
  }

  // Desconta do reservatório
  state.foodGrams = Math.max(0, state.foodGrams - grams);
  state.lastFeedTime = new Date();
  state.feederStatus = state.foodGrams <= 0 ? 'empty' : 'waiting';
  state.gaugeNeedsUpdate = true; // marca para atualização do gauge

  // Adiciona ao histórico do cachorro atual
  const dog = getCurrentDog();
  if (dog) {
    if (!dog.history) dog.history = [];
    const now = state.lastFeedTime;
    dog.history.unshift({
      id: Date.now(),
      date: now.toLocaleDateString('pt-BR'),
      time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      grams,
      type:       'manual',
      status:     'consumed',
      eatMinutes: Math.round(3 + Math.random() * 5),
    });
    saveCurrentUser();
  }

  return {
    success: true,
    message: `${grams}g liberados para ${dog?.name || 'o pet'}!`,
    remainingGrams: state.foodGrams,
  };
}

/**
 * POST /schedule { schedules, dogId }
 * Envia lista de horários ao ESP32.
 */
async function apiSaveSchedules(schedules) {
  await simulateDelay();
  return { success: true };
}

/* ================================================================
   5. SESSÃO / AUTH
   ================================================================ */

function loadUsers() {
  try { return JSON.parse(localStorage.getItem('pf_users') || '[]'); }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem('pf_users', JSON.stringify(users));
}

function saveCurrentUser() {
  const users = loadUsers();
  const idx   = users.findIndex(u => u.username === state.currentUser.username);
  if (idx >= 0) {
    users[idx] = state.currentUser;
    saveUsers(users);
  }
}

/**
 * Carrega usuário da sessão.
 * Se não estiver logado, redireciona para login.
 */
function initSession() {
  const username = sessionStorage.getItem('pf_user');
  if (!username) {
    window.location.href = 'login.html';
    return false;
  }

  const users = loadUsers();
  let user = users.find(u => u.username === username);

  // Garante que existe (cria demo se necessário)
  if (!user) {
    user = {
      username,
      dogs: [
        { id: 1, name: 'Thor', weight: 8, age: 3, color: '#2f80ed' },
        { id: 2, name: 'Luna', weight: 5, age: 2, color: '#9b51e0' },
      ]
    };
    users.push(user);
    saveUsers(users);
  }

  // Garante histórico e horários mockados para cada cachorro
  user.dogs = user.dogs.map(dog => ({
    ...dog,
    history:   dog.history   || getMockHistory(dog.id),
    schedules: dog.schedules || getMockSchedules(dog.id),
  }));

  state.currentUser = user;
  saveCurrentUser();

  // Nome do usuário no nav
  document.getElementById('nav-user-name').textContent = username;

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    sessionStorage.removeItem('pf_user');
    window.location.href = 'login.html';
  });

  return true;
}

/* ================================================================
   6. NAVEGAÇÃO
   ================================================================ */

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.hidden = true;
  });

  const target = document.getElementById(`page-${pageId}`);
  if (target) { target.classList.add('active'); target.hidden = false; }

  document.querySelectorAll('.nav-btn, .bottom-nav__btn').forEach(btn => {
    const active = btn.dataset.page === pageId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  state.currentPage = pageId;

  // Ações por página
  if (pageId === 'dashboard') refreshDashboard();
  if (pageId === 'history')   renderHistory(state.activeFilter);
  if (pageId === 'schedule')  renderScheduleList();
  if (pageId === 'data')      renderDataPage();
}

function initNavigation() {
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

/* ================================================================
   7. TOAST
   ================================================================ */

function showToast(message, type = '', duration = 3200) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${type ? ` toast--${type}` : ''}`;
  const icons = { success: '✅', danger: '❌', warning: '⚠️', '': 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || icons['']}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--hide');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

/* ================================================================
   8. MODAIS
   ================================================================ */

function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.hidden = true; document.body.style.overflow = ''; }
}

function initModals() {
  document.getElementById('modal-dog-close')?.addEventListener('click',     () => closeModal('modal-dog'));
  document.getElementById('modal-add-dog-close')?.addEventListener('click', () => closeModal('modal-add-dog'));

  // Fechar clicando fora
  ['modal-dog', 'modal-add-dog'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target.id === id) closeModal(id);
    });
  });

  // Abrir modal de seleção de cão
  document.getElementById('dog-chip-btn')?.addEventListener('click', () => {
    renderDogList();
    openModal('modal-dog');
  });
  document.getElementById('dash-dog-pill')?.addEventListener('click', () => {
    renderDogList();
    openModal('modal-dog');
  });

  // Abrir modal de adicionar cão
  document.getElementById('btn-add-dog')?.addEventListener('click', () => {
    closeModal('modal-dog');
    openModal('modal-add-dog');
  });

  // Cores no modal de adicionar cão
  document.querySelectorAll('#add-dog-colors .avatar-color').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#add-dog-colors .avatar-color').forEach(b => {
        b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    });
  });

  // Salvar novo cão
  document.getElementById('btn-save-new-dog')?.addEventListener('click', () => {
    const name   = document.getElementById('new-dog-name').value.trim();
    const weight = parseFloat(document.getElementById('new-dog-weight').value) || null;
    const age    = parseInt(document.getElementById('new-dog-age').value) || null;
    const colorBtn = document.querySelector('#add-dog-colors .avatar-color.active');
    const color  = colorBtn?.dataset.color || '#2f80ed';

    if (!name) { showToast('Informe o nome do cachorro', 'warning'); return; }

    const newDog = {
      id:        Date.now(),
      name, weight, age, color,
      history:   getMockHistory(Date.now()),
      schedules: getMockSchedules(Date.now()),
    };

    state.currentUser.dogs.push(newDog);
    saveCurrentUser();

    // Seleciona automaticamente
    selectDog(newDog.id);

    // Limpa form
    document.getElementById('new-dog-name').value   = '';
    document.getElementById('new-dog-weight').value = '';
    document.getElementById('new-dog-age').value    = '';

    closeModal('modal-add-dog');
    showToast(`${name} adicionado com sucesso!`, 'success');
  });
}

/* ================================================================
   9. SELEÇÃO DE CACHORRO
   ================================================================ */

function getCurrentDog() {
  if (!state.currentUser || !state.currentDog) return null;
  return state.currentUser.dogs.find(d => d.id === state.currentDog.id) || null;
}

/**
 * Seleciona o cachorro ativo e atualiza toda a UI.
 */
function selectDog(dogId) {
  const dog = state.currentUser.dogs.find(d => d.id === dogId);
  if (!dog) return;

  state.currentDog = dog;
  state.foodGrams  = 150 + Math.round(Math.random() * 100); // simula leitura do sensor
  state.lastFeedTime = null;
  state.gaugeNeedsUpdate = true;

  // Atualiza chips de navegação
  document.getElementById('nav-dog-name').textContent   = dog.name;
  document.getElementById('nav-dog-avatar').textContent = dogInitial(dog);

  // Atualiza pill do dashboard
  document.getElementById('dash-dog-name').textContent = dog.name;
  const dot = document.getElementById('dash-dog-dot');
  if (dot) dot.style.background = dog.color;

  // Salva seleção na sessão
  sessionStorage.setItem('pf_selected_dog', dogId);

  // Atualiza dashboard
  refreshDashboard();
  updateGauge(true);

  closeModal('modal-dog');
}

/** Renderiza lista de cães no modal */
function renderDogList() {
  const ul = document.getElementById('dog-list');
  if (!ul || !state.currentUser) return;
  ul.innerHTML = '';

  state.currentUser.dogs.forEach(dog => {
    const isActive = state.currentDog?.id === dog.id;
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="dog-list-item${isActive ? ' active' : ''}" data-dog-id="${dog.id}" role="button" tabindex="0" aria-label="Selecionar ${dog.name}">
        <div class="dog-list-item__info">
          <div class="dog-avatar" style="background:${dog.color}">${dogInitial(dog)}</div>
          <div>
            <div class="dog-info-name">${dog.name}</div>
            <div class="dog-info-meta">${dog.weight ? dog.weight + 'kg' : ''}${dog.weight && dog.age ? ' · ' : ''}${dog.age ? dog.age + ' anos' : ''}</div>
          </div>
        </div>
        ${isActive ? '<i class="ph ph-check-circle dog-check"></i>' : ''}
      </div>
    `;
    li.querySelector('.dog-list-item').addEventListener('click', () => selectDog(dog.id));
    li.querySelector('.dog-list-item').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') selectDog(dog.id);
    });
    ul.appendChild(li);
  });
}

/** Retorna inicial do nome do cachorro para avatar */
function dogInitial(dog) {
  return dog.name ? dog.name.charAt(0).toUpperCase() : '🐕';
}

/* ================================================================
   10. DASHBOARD
   ================================================================ */

function calcNextFeedTime() {
  const dog = getCurrentDog();
  if (!dog?.schedules) return '--:--';
  const active = dog.schedules.filter(s => s.enabled);
  if (!active.length) return '--:--';

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const upcoming = active
    .map(s => { const [h, m] = s.time.split(':').map(Number); return h * 60 + m; })
    .filter(t => t > nowMin)
    .sort((a, b) => a - b);

  if (!upcoming.length) return active.map(s => s.time).sort()[0] || '--:--';

  const h = String(Math.floor(upcoming[0] / 60)).padStart(2, '0');
  const m = String(upcoming[0] % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function refreshDashboard() {
  const dog = getCurrentDog();

  // Saudação
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Bom dia! ☀️' : hr < 18 ? 'Boa tarde! 🌤️' : 'Boa noite! 🌙';
  document.getElementById('dash-greeting').textContent = greet;
  document.getElementById('dash-subtitle').textContent = dog
    ? `Monitorando: ${dog.name}`
    : 'Selecione um cachorro para começar';

  // Próxima alimentação
  document.getElementById('next-feed-time').textContent = dog ? calcNextFeedTime() : '--:--';

  // Última alimentação
  document.getElementById('last-feed-time').textContent = state.lastFeedTime
    ? state.lastFeedTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : 'Nenhuma hoje';

  // Ração no pote
  const pct = Math.max(0, Math.min(100, (state.foodGrams / MAX_BOWL_CAPACITY_G) * 100));
  document.getElementById('food-grams').textContent = `${state.foodGrams}g`;
  document.getElementById('food-level-bar').style.width = `${pct}%`;

  // Status
  const statusEl = document.getElementById('feeder-status');
  const map = {
    full:    { text: '🟢 Pote cheio',        css: 'full'    },
    empty:   { text: '🔴 Pote vazio',         css: 'empty'   },
    waiting: { text: '🟡 Aguardando horário', css: 'waiting' },
  };
  const s = map[state.feederStatus] || map.waiting;
  statusEl.textContent = s.text;
  statusEl.className   = `card__value status-text ${s.css}`;

  // Atualiza gauge se necessário
  if (state.gaugeNeedsUpdate) {
    updateGauge(false);
    state.gaugeNeedsUpdate = false;
  }

  renderAlerts();
}

/* ================================================================
   11. GRÁFICO GAUGE (reservatório)
   IMPORTANTE: só atualiza quando explicitamente solicitado.
   ================================================================ */

function initGauge() {
  const canvas = document.getElementById('gauge-chart');
  if (!canvas || !window.Chart) return;

  const pct = Math.round((state.foodGrams / MAX_BOWL_CAPACITY_G) * 100);

  state.gaugeChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: [
          pct > 50 ? '#27ae60' : pct > 20 ? '#f2994a' : '#eb5757',
          '#e2e8f0'
        ],
        borderWidth: 0,
        hoverOffset: 0,
      }]
    },
    options: {
      cutout: '75%',
      rotation: -90,
      circumference: 180,
      responsive: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 800, easing: 'easeInOutQuart' },
    }
  });

  document.getElementById('gauge-pct').textContent = `${pct}%`;
}

/**
 * Atualiza o gauge com o valor atual de foodGrams.
 * @param {boolean} animate — se verdadeiro, anima a transição
 */
function updateGauge(animate = true) {
  if (!state.gaugeChart) return;

  const pct = Math.round(Math.max(0, Math.min(100, (state.foodGrams / MAX_BOWL_CAPACITY_G) * 100)));
  const color = pct > 50 ? '#27ae60' : pct > 20 ? '#f2994a' : '#eb5757';

  state.gaugeChart.data.datasets[0].data             = [pct, 100 - pct];
  state.gaugeChart.data.datasets[0].backgroundColor  = [color, '#e2e8f0'];
  state.gaugeChart.options.animation.duration        = animate ? 800 : 0;
  state.gaugeChart.update();

  document.getElementById('gauge-pct').textContent = `${pct}%`;
}

function initRefreshChartBtn() {
  document.getElementById('btn-refresh-chart')?.addEventListener('click', () => {
    updateGauge(true);
    showToast('Nível do reservatório atualizado', 'success', 2000);
  });
}

/* ================================================================
   12. CONTROLE MANUAL
   ================================================================ */

function setSelectedQty(qty) {
  state.selectedQty = qty;
  document.querySelectorAll('.qty-btn').forEach(btn => {
    const active = parseInt(btn.dataset.qty) === qty;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('selected-qty-display').textContent = `${qty}g`;
}

async function performFeed(grams) {
  if (!state.currentDog) {
    showToast('Selecione um cachorro primeiro!', 'warning');
    openModal('modal-dog');
    renderDogList();
    return;
  }
  if (!grams || grams < 5 || grams > 300) {
    showToast('Quantidade inválida (5g – 300g)', 'warning');
    return;
  }

  const btnIds = ['btn-manual-feed', 'btn-quick-feed'];
  btnIds.forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = true; }
  });

  try {
    const result = await apiFeed(grams, state.currentDog.id);
    if (result.success) {
      showToast(result.message, 'success');

      // Atualiza gauge imediatamente após liberar
      state.gaugeNeedsUpdate = false;
      updateGauge(true);

      // Feedback na página manual
      const fb  = document.getElementById('manual-feedback');
      const msg = document.getElementById('feedback-message');
      if (fb && msg) {
        msg.textContent = `${grams}g liberados! Restam ~${result.remainingGrams}g no reservatório.`;
        fb.hidden = false;
        setTimeout(() => { fb.hidden = true; }, 4000);
      }
      refreshDashboard();
    } else {
      showToast(result.message, 'danger');
    }
  } catch (err) {
    showToast('Erro: não foi possível conectar ao ESP32', 'danger');
  } finally {
    btnIds.forEach(id => {
      const b = document.getElementById(id);
      if (b) { b.disabled = false; }
    });
  }
}

function initManualPage() {
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setSelectedQty(parseInt(btn.dataset.qty));
      document.getElementById('custom-qty').value = '';
    });
  });

  document.getElementById('custom-qty')?.addEventListener('input', function () {
    const val = parseInt(this.value);
    if (!isNaN(val) && val >= 5 && val <= 300) {
      state.selectedQty = val;
      document.querySelectorAll('.qty-btn').forEach(b => {
        b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
      });
      document.getElementById('selected-qty-display').textContent = `${val}g`;
    }
  });

  document.getElementById('btn-manual-feed')?.addEventListener('click', () => performFeed(state.selectedQty));
  document.getElementById('btn-quick-feed')?.addEventListener('click', () => performFeed(DEFAULT_FEED_GRAMS));
}

/* ================================================================
   13. HORÁRIOS
   ================================================================ */

function renderScheduleList() {
  const dog   = getCurrentDog();
  const list  = document.getElementById('schedule-list');
  const empty = document.getElementById('schedule-empty');
  if (!list) return;
  list.innerHTML = '';

  const schedules = dog?.schedules || [];

  if (!schedules.length) { empty.hidden = false; return; }
  empty.hidden = true;

  schedules.forEach(sched => {
    const li = document.createElement('li');
    li.className = 'schedule-item';
    const daysText = sched.days.length === 7
      ? 'Todos os dias'
      : sched.days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');

    li.innerHTML = `
      <div class="schedule-item__info">
        <span class="schedule-item__time">${sched.time}</span>
        <span class="schedule-item__meta">${sched.grams}g · ${daysText}</span>
      </div>
      <div class="schedule-item__toggle">
        <label class="toggle" title="${sched.enabled ? 'Ativo' : 'Inativo'}">
          <input type="checkbox" ${sched.enabled ? 'checked' : ''} aria-label="Ativar ${sched.time}">
          <span class="toggle-track"></span>
        </label>
        <button class="btn btn--ghost" data-del="${sched.id}" aria-label="Remover ${sched.time}">
          <i class="ph ph-trash"></i>
        </button>
      </div>
    `;

    li.querySelector('input[type=checkbox]').addEventListener('change', function () {
      const s = dog.schedules.find(x => x.id === sched.id);
      if (s) {
        s.enabled = this.checked;
        saveCurrentUser();
        apiSaveSchedules(dog.schedules);
        showToast(`Horário ${sched.time} ${this.checked ? 'ativado' : 'desativado'}`, this.checked ? 'success' : '');
      }
    });

    li.querySelector('[data-del]').addEventListener('click', () => {
      dog.schedules = dog.schedules.filter(s => s.id !== sched.id);
      saveCurrentUser();
      renderScheduleList();
      showToast('Horário removido', 'warning');
    });

    list.appendChild(li);
  });
}

function initSchedulePage() {
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', String(btn.classList.contains('active')));
    });
  });

  document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
    const dog = getCurrentDog();
    if (!dog) { showToast('Selecione um cachorro primeiro!', 'warning'); return; }

    const time  = document.getElementById('sched-time').value;
    const grams = parseInt(document.getElementById('sched-qty').value);

    if (!time) { showToast('Informe o horário', 'warning'); return; }
    if (!grams || grams < 5 || grams > 300) { showToast('Quantidade inválida (5g – 300g)', 'warning'); return; }

    const days = [...document.querySelectorAll('.day-btn.active')].map(b => b.dataset.day);
    if (!days.length) { showToast('Selecione ao menos um dia', 'warning'); return; }
    if (dog.schedules.some(s => s.time === time)) { showToast(`Já existe um horário às ${time}`, 'warning'); return; }

    dog.schedules.push({ id: Date.now(), time, grams, days, enabled: true });
    dog.schedules.sort((a, b) => a.time.localeCompare(b.time));
    saveCurrentUser();
    apiSaveSchedules(dog.schedules);
    renderScheduleList();
    showToast(`Horário ${time} salvo!`, 'success');

    document.getElementById('sched-time').value = '';
    document.getElementById('sched-qty').value  = '';
  });
}

/* ================================================================
   14. HISTÓRICO
   ================================================================ */

function renderHistory(filter = 'all') {
  state.activeFilter = filter;
  const dog     = getCurrentDog();
  const history = dog?.history || [];

  const data = filter === 'all'
    ? history
    : history.filter(h => h.status === filter);

  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--color-muted);padding:2rem">Nenhum registro encontrado.</td></tr>`;
  } else {
    data.forEach(item => {
      const tr = document.createElement('tr');
      const badgeClass = item.status === 'consumed' ? 'badge--success' : 'badge--danger';
      const badgeText  = item.status === 'consumed' ? '✔ Consumido' : '✘ Não consumido';
      const typeBadge  = item.type === 'auto'
        ? '<span class="badge badge--info">Auto</span>'
        : '<span class="badge" style="background:rgba(100,116,139,.1);color:var(--color-muted)">Manual</span>';

      tr.innerHTML = `
        <td>${item.date}</td>
        <td><strong>${item.time}</strong></td>
        <td><strong>${item.grams}g</strong></td>
        <td>${typeBadge}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Stats
  const all      = history;
  const consumed = all.filter(h => h.status === 'consumed');
  const totalG   = all.reduce((s, h) => s + h.grams, 0);
  document.getElementById('stat-total').textContent    = all.length;
  document.getElementById('stat-consumed').textContent = consumed.length;
  document.getElementById('stat-grams').textContent    = `${totalG}g`;
}

function initHistoryPage() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderHistory(btn.dataset.filter);
    });
  });
}

/* ================================================================
   15. DADOS TCC
   ================================================================ */

function renderDataPage() {
  const dog = getCurrentDog();
  const history = dog?.history || [];

  /* ── KPIs ── */
  const consumed = history.filter(h => h.status === 'consumed');
  const totalG   = consumed.reduce((s, h) => s + h.grams, 0);
  const avgDaily = history.length ? Math.round(totalG / 7) : 0;
  const rejection = history.length ? Math.round(((history.length - consumed.length) / history.length) * 100) : 0;
  const eatTimes  = consumed.map(h => h.eatMinutes).filter(Boolean);
  const avgEat    = eatTimes.length ? (eatTimes.reduce((a, b) => a + b, 0) / eatTimes.length).toFixed(1) : '--';

  document.getElementById('kpi-avg-daily').textContent = avgDaily;
  document.getElementById('kpi-total').textContent     = totalG;
  document.getElementById('kpi-avg-time').textContent  = avgEat;
  document.getElementById('kpi-rejection').textContent = rejection;

  /* ── Gráfico de consumo diário ── */
  const dailyData   = getMockDailyConsumption(dog?.id || 1);
  const dailyLabels = getLast7DaysLabels();

  if (state.consumptionChart) state.consumptionChart.destroy();

  const ctxConsumption = document.getElementById('consumption-chart');
  if (ctxConsumption && window.Chart) {
    state.consumptionChart = new Chart(ctxConsumption, {
      type: 'bar',
      data: {
        labels: dailyLabels,
        datasets: [{
          label: 'Ração consumida (g)',
          data:  dailyData,
          backgroundColor: 'rgba(47,128,237,.2)',
          borderColor:     '#2f80ed',
          borderWidth:     2,
          borderRadius:    6,
          borderSkipped:   false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: { color: '#64748b', font: { family: 'Nunito' } }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { family: 'Nunito' } }
          }
        }
      }
    });
  }

  /* ── Gráfico de distribuição por horário ── */
  if (state.scheduleChart) state.scheduleChart.destroy();

  const schedHours = (dog?.schedules || []).map(s => s.time);
  const feedsByHour = { 'Manhã (6-11h)': 0, 'Tarde (12-17h)': 0, 'Noite (18-23h)': 0 };
  history.forEach(h => {
    const hr = parseInt(h.time.split(':')[0]);
    if (hr >= 6 && hr < 12)       feedsByHour['Manhã (6-11h)']++;
    else if (hr >= 12 && hr < 18) feedsByHour['Tarde (12-17h)']++;
    else                          feedsByHour['Noite (18-23h)']++;
  });

  const ctxSchedule = document.getElementById('schedule-chart');
  if (ctxSchedule && window.Chart) {
    state.scheduleChart = new Chart(ctxSchedule, {
      type: 'doughnut',
      data: {
        labels: Object.keys(feedsByHour),
        datasets: [{
          data: Object.values(feedsByHour),
          backgroundColor: ['#f2994a', '#2f80ed', '#27ae60'],
          borderWidth: 0,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { family: 'Nunito', weight: '700' }, color: '#64748b', padding: 16 }
          }
        }
      }
    });
  }

  /* ── Tabela de dados brutos ── */
  const tbody = document.getElementById('data-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  history.slice(0, 10).forEach(item => {
    const tr = document.createElement('tr');
    const ok = item.status === 'consumed';
    tr.innerHTML = `
      <td>${item.date}</td>
      <td>${item.time}</td>
      <td><strong>${item.grams}g</strong></td>
      <td><span class="badge ${ok ? 'badge--success' : 'badge--danger'}">${ok ? 'Sim' : 'Não'}</span></td>
      <td>${ok ? item.eatMinutes + ' min' : '—'}</td>
      <td><span class="badge ${item.type === 'auto' ? 'badge--info' : ''}">${item.type === 'auto' ? 'Automático' : 'Manual'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ================================================================
   16. EXPORTAÇÃO
   ================================================================ */

/**
 * Exporta histórico para Excel (.xlsx) usando SheetJS.
 */
function exportToExcel() {
  const dog     = getCurrentDog();
  const history = dog?.history || [];

  if (!history.length) { showToast('Sem dados para exportar', 'warning'); return; }
  if (!window.XLSX)    { showToast('Biblioteca SheetJS não carregada', 'danger'); return; }

  const dogName = dog?.name || 'pet';
  const now     = new Date().toLocaleDateString('pt-BR');

  // Prepara linhas
  const rows = history.map(h => ({
    'Data':          h.date,
    'Horário':       h.time,
    'Quantidade (g)': h.grams,
    'Tipo':          h.type === 'auto' ? 'Automático' : 'Manual',
    'Consumido':     h.status === 'consumed' ? 'Sim' : 'Não',
    'Tempo (min)':   h.status === 'consumed' ? h.eatMinutes : 0,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, dogName);
  XLSX.writeFile(wb, `PetFeeder_${dogName}_${now.replace(/\//g, '-')}.xlsx`);

  showToast('Arquivo Excel gerado!', 'success');
}

/**
 * Exporta relatório em PDF usando jsPDF.
 */
function exportToPDF() {
  const dog     = getCurrentDog();
  const history = dog?.history || [];

  if (!window.jspdf) { showToast('Biblioteca jsPDF não carregada', 'danger'); return; }

  const { jsPDF } = window.jspdf;
  const doc    = new jsPDF();
  const dogName = dog?.name || 'Pet';
  const now     = new Date().toLocaleString('pt-BR');

  // Cabeçalho
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(47, 128, 237);
  doc.text('PetFeeder — Relatório TCC', 14, 20);

  doc.setFontSize(11);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text(`Cachorro: ${dogName}`, 14, 30);
  doc.text(`Gerado em: ${now}`, 14, 36);

  // KPIs
  const consumed  = history.filter(h => h.status === 'consumed');
  const totalG    = consumed.reduce((s, h) => s + h.grams, 0);
  const avgDaily  = history.length ? Math.round(totalG / 7) : 0;
  const rejection = history.length ? Math.round(((history.length - consumed.length) / history.length) * 100) : 0;

  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.text('Resumo do período:', 14, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const kpis = [
    `Total de refeições: ${history.length}`,
    `Refeições consumidas: ${consumed.length}`,
    `Total de ração liberada: ${totalG}g`,
    `Média diária: ${avgDaily}g/dia`,
    `Taxa de rejeição: ${rejection}%`,
  ];
  kpis.forEach((txt, i) => doc.text(txt, 14, 56 + i * 7));

  // Tabela de histórico
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Histórico de alimentações:', 14, 100);

  // Cabeçalho da tabela
  const cols = ['Data', 'Horário', 'Qtd.', 'Tipo', 'Consumido', 'Tempo'];
  let y = 108;
  doc.setFillColor(240, 244, 248);
  doc.rect(14, y - 4, 182, 8, 'F');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const colW = [28, 22, 18, 24, 28, 22];
  let x = 14;
  cols.forEach((col, i) => { doc.text(col, x + 1, y); x += colW[i]; });

  // Linhas
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  history.slice(0, 15).forEach((item, idx) => {
    y += 7;
    if (y > 270) { doc.addPage(); y = 20; }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y - 4, 182, 7, 'F');
    }

    const row = [
      item.date,
      item.time,
      `${item.grams}g`,
      item.type === 'auto' ? 'Auto' : 'Manual',
      item.status === 'consumed' ? 'Sim' : 'Não',
      item.status === 'consumed' ? `${item.eatMinutes}min` : '—',
    ];
    x = 14;
    row.forEach((val, i) => { doc.text(String(val), x + 1, y); x += colW[i]; });
  });

  // Rodapé
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('PetFeeder — TCC Engenharia de Automação — dados simulados', 14, 287);
    doc.text(`Pág. ${p}/${totalPages}`, 190, 287, { align: 'right' });
  }

  doc.save(`PetFeeder_${dogName}_${now.slice(0,10).replace(/\//g,'-')}.pdf`);
  showToast('PDF gerado com sucesso!', 'success');
}

function initExportButtons() {
  document.getElementById('btn-export-excel')?.addEventListener('click', exportToExcel);
  document.getElementById('btn-export-pdf')?.addEventListener('click', exportToPDF);
}

/* ================================================================
   17. ALERTAS
   ================================================================ */

function renderAlerts() {
  const container = document.getElementById('alerts-list');
  if (!container) return;
  container.innerHTML = '';

  const dog     = getCurrentDog();
  const history = dog?.history || [];
  const alerts  = [];

  if (!state.currentDog) {
    alerts.push({ type: 'warning', icon: '🐕', text: 'Nenhum cachorro selecionado. Clique em "Selecionar" para começar.' });
  }

  if (state.foodGrams <= 0) {
    alerts.push({ type: 'danger',  icon: '🚨', text: 'Pote vazio! Reabasteça imediatamente.' });
  } else if (state.foodGrams < MAX_BOWL_CAPACITY_G * 0.2) {
    alerts.push({ type: 'warning', icon: '⚠️', text: `Nível baixo de ração: ${state.foodGrams}g restantes.` });
  }

  const lastEntry = history[0];
  if (lastEntry?.status === 'not-consumed') {
    alerts.push({ type: 'warning', icon: '🍽️', text: `Ração não consumida na última alimentação (${lastEntry.time}).` });
  }

  if (dog && !dog.schedules?.filter(s => s.enabled).length) {
    alerts.push({ type: 'warning', icon: '📅', text: 'Nenhum horário automático ativo.' });
  }

  if (!alerts.length) {
    container.innerHTML = `<p style="color:var(--color-muted);font-size:.88rem">✅ Tudo em ordem!</p>`;
    return;
  }

  alerts.forEach(a => {
    const div = document.createElement('div');
    div.className = `alert-item alert--${a.type}`;
    div.innerHTML = `<span class="alert-icon">${a.icon}</span><span>${a.text}</span>`;
    container.appendChild(div);
  });
}

/* ================================================================
   17. STATUS DE CONEXÃO
   ================================================================ */

function setConnectionStatus(online) {
  state.connected = online;
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (online) {
    dot.className     = 'status-dot online';
    label.textContent = 'ESP32 conectado';
  } else {
    dot.className     = 'status-dot offline';
    label.textContent = 'Sem conexão';
  }
}

async function checkConnection() {
  await simulateDelay(600);
  /**
   * Para ESP32 real:
   *   const res = await fetch(`${ESP32_BASE_URL}/status`, { signal: AbortSignal.timeout(3000) });
   *   setConnectionStatus(res.ok);
   */
  setConnectionStatus(true);
}

/* ================================================================
   18. INICIALIZAÇÃO
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Verifica sessão (redireciona para login se não logado)
  if (!initSession()) return;

  // 2. Inicializa módulos de UI
  initNavigation();
  initModals();
  initManualPage();
  initSchedulePage();
  initHistoryPage();
  initExportButtons();

  // 3. Seleciona cachorro salvo na sessão (ou o primeiro da lista)
  const savedDogId = parseInt(sessionStorage.getItem('pf_selected_dog'));
  const dogToLoad  = state.currentUser.dogs.find(d => d.id === savedDogId)
                  || state.currentUser.dogs[0];

  if (dogToLoad) selectDog(dogToLoad.id);

  // 4. Gráfico gauge (inicia com valor do estado)
  initGauge();
  initRefreshChartBtn();

  // 5. Página inicial
  navigateTo('dashboard');

  // 6. Verifica conexão com ESP32
  checkConnection();

  console.log('🐾 PetFeeder v2 inicializado');
  console.log(`👤 Usuário: ${state.currentUser.username}`);
  console.log(`🐕 Pet: ${state.currentDog?.name || 'nenhum'}`);
  console.log(`📡 ESP32 URL: ${ESP32_BASE_URL} (modo simulado)`);
});
