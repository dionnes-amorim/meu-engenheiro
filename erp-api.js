
'use strict';

// ======================================================
// PH ENGENHARIA — ERP DE GESTÃO DE OBRAS
// Persistência: API do servidor + Supabase.
// Autenticação: página externa + cookie HttpOnly.
// Não utiliza localStorage ou sessionStorage.
// ======================================================

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

const n = v => Number.isFinite(Number(v)) ? Number(v) : 0;

const money = v => n(v).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const todayISO = () => {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const makeId = () => (
  window.crypto?.randomUUID
    ? crypto.randomUUID()
    : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
);

const stageNames = [
  'Viabilidade e documentação',
  'Terraplanagem',
  'Fundação',
  'Alvenaria',
  'Estrutura',
  'Cobertura',
  'Instalações',
  'Reboco',
  'Acabamento',
  'Esquadrias',
  'Pintura',
  'Entrega'
];

const caixaChecklistItems = [
  'ART de execução',
  'Matrícula atualizada',
  'Alvará de construção',
  'Projeto aprovado na prefeitura',
  'Memorial descritivo',
  'Cronograma físico-financeiro',
  'Fotos da medição',
  'Notas fiscais da etapa',
  'CND / INSS'
];

const cronogramaBase = [
  { etapa: 'Fundação', percentual: 15, data: '' },
  { etapa: 'Alvenaria e estrutura', percentual: 25, data: '' },
  { etapa: 'Cobertura', percentual: 15, data: '' },
  { etapa: 'Instalações e reboco', percentual: 20, data: '' },
  { etapa: 'Acabamento', percentual: 20, data: '' },
  { etapa: 'Entrega', percentual: 5, data: '' }
];

const viewLabels = {
  'visao-geral': 'Visão geral',
  'financeiro': 'Orçamento',
  'caixa': 'CAIXA / MCMV',
  'fornecedores': 'Fornecedores',
  'estoque': 'Estoque',
  'calculadoras': 'Calculadoras',
  'fluxo': 'Fluxo de caixa',
  'documentos': 'Documentos',
  'relatorios': 'Relatórios',
  'cronograma': 'Cronograma físico',
  'diario': 'Diário de obra',
  'compras': 'Compras e cotações',
  'contas': 'Contas a pagar/receber',
  'historico': 'Histórico'
};

const appState = {
  records: [],
  portalClients: [],
  current: null,
  data: null,
  editId: null,
  saveTimer: null,
  historyTimer: null,
  pendingAuditLabel: null,
  saving: false,
  dirty: false,
  revision: 0,
  files: [],
  updates: [],
  calcItems: []
};

// ======================================================
// ESTRUTURA DOS DADOS
// ======================================================

function emptyData(meta = {}) {
  return {
    versao: 2,

    meta: {
      margem_lucro: n(meta.margem_lucro ?? 20),
      prazo_meses: n(meta.prazo_meses ?? 0),
      metragem_terreno: n(meta.metragem_terreno ?? 0),
      metragem_construcao: n(meta.metragem_construcao ?? 0),
      caixa_contrato: meta.caixa_contrato || '',
      caixa_valor: n(meta.caixa_valor ?? 0),
      caixa_engenheiro: meta.caixa_engenheiro || ''
    },

    financeiro: {
      etapas: stageNames.map(nome => ({
        id: makeId(),
        nome,
        orcado: 0,
        realizado: 0
      })),
      taxas: 0,
      observacao: ''
    },

    caixa: {
      percentualLiberado: 0,
      proximaMedicao: '',
      checklist: {},
      cronograma: JSON.parse(JSON.stringify(cronogramaBase))
    },

    fornecedores: [],
    estoque: [],
    fluxo: [],
    contratos: [],
    recibos: [],
    extras: [],

    cronogramaFisico: [],
    diario: [],
    compras: [],
    cotacoes: [],
    contas: [],
    historico: []
  };
}

function mergeData(raw, meta = {}) {
  const base = emptyData(meta);

  if (!raw || typeof raw !== 'object') return base;

  const d = { ...base, ...raw };

  d.versao = 2;

  d.meta = {
    ...base.meta,
    ...(raw.meta || {})
  };

  d.financeiro = {
    ...base.financeiro,
    ...(raw.financeiro || {})
  };

  d.financeiro.etapas =
    Array.isArray(raw.financeiro?.etapas)
      ? raw.financeiro.etapas
      : base.financeiro.etapas;

  d.caixa = {
    ...base.caixa,
    ...(raw.caixa || {})
  };

  d.caixa.checklist = {
    ...(raw.caixa?.checklist || {})
  };

  d.caixa.cronograma =
    Array.isArray(raw.caixa?.cronograma)
      ? raw.caixa.cronograma
      : JSON.parse(JSON.stringify(cronogramaBase));

  [
    'fornecedores',
    'estoque',
    'fluxo',
    'contratos',
    'recibos',
    'extras',
    'cronogramaFisico',
    'diario',
    'compras',
    'cotacoes',
    'contas',
    'historico'
  ].forEach(k => {
    d[k] = Array.isArray(raw[k]) ? raw[k] : [];
  });

  return d;
}

// ======================================================
// NOTIFICAÇÕES
// ======================================================

function toast(message, type = '') {
  const el = document.createElement('div');

  el.className = 'erp-toast ' + type;
  el.textContent = message;

  $('#toastContainer').appendChild(el);

  setTimeout(() => el.remove(), 4500);
}

// ======================================================
// AUTENTICAÇÃO EXTERNA
// ======================================================

// O login NÃO é realizado nesta página.
// O login é feito exclusivamente na tela externa.
// O navegador envia automaticamente o cookie HttpOnly.

function ensureExternalSessionGate() {
  let gate = $('#erpLoginGate');

  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'erpLoginGate';

    document.body.appendChild(gate);
  }

  gate.classList.add('erp-login-gate');

  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'erpSessionTitle');

  if (!$('#erpExternalGateStyle')) {
    const style = document.createElement('style');

    style.id = 'erpExternalGateStyle';

    style.textContent = `
      .erp-login-gate {
        position: fixed;
        inset: 0;
        z-index: 30000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 22px;
        background: rgba(23,26,29,.96);
        backdrop-filter: blur(7px);
      }

      .erp-login-gate[hidden] {
        display: none !important;
      }

      body:not(.erp-authenticated) .app-container {
        visibility: hidden;
      }

      .erp-login-card {
        width: min(100%,440px);
        padding: 28px;
        background: #f8f7f3;
        border: 1px solid #b8945e;
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
      }

      .erp-login-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 22px;
      }

      .erp-login-mark {
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        border: 1px solid #b8945e;
        border-radius: 10px;
        color: #d5b783;
        font-weight: 800;
        background: #202428;
      }

      .erp-login-brand strong {
        display: block;
        color: #292b2b;
        font-size: 13px;
        letter-spacing: .07em;
      }

      .erp-login-brand small {
        display: block;
        margin-top: 3px;
        color: #85877f;
        font-size: 9px;
        letter-spacing: .12em;
      }

      .erp-login-card h2 {
        margin: 0 0 7px;
        color: #292b2b;
        font-size: 22px;
      }

      .erp-login-card p {
        margin: 0 0 14px;
        color: #77766e;
        font-size: 11px;
        line-height: 1.65;
      }

      .erp-session-actions {
        display: grid;
        gap: 9px;
        margin-top: 18px;
      }

      .erp-session-actions button {
        width: 100%;
        min-height: 43px;
      }

      .erp-login-foot {
        margin-top: 17px;
        color: #918b7e;
        font-size: 9px;
        line-height: 1.5;
        text-align: center;
      }

      @media(max-width:520px) {
        .erp-login-card {
          padding: 22px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  return gate;
}

function showSessionGate(message = 'A sessão administrativa não foi encontrada.') {
  document.body.classList.remove('erp-authenticated');

  const gate = ensureExternalSessionGate();

  gate.hidden = false;

  // Substitui inclusive qualquer formulário antigo de login.
  // Nenhuma senha é solicitada nesta página.

  gate.innerHTML = `
    <div class="erp-login-card">

      <div class="erp-login-brand">
        <div class="erp-login-mark">PH</div>

        <div>
          <strong>PH ENGENHARIA</strong>
          <small>CENTRAL DE GESTÃO · ACESSO RESTRITO</small>
        </div>
      </div>

      <h2 id="erpSessionTitle">Acesso administrativo</h2>

      <p>${esc(message)}</p>

      <p>
        O login é realizado na página externa de acesso.
        Entre por ela e, depois, retorne a esta tela.
        A sessão será reconhecida automaticamente pelo cookie seguro do navegador.
      </p>

      <div class="erp-session-actions">

        <button type="button" class="btn-primary" id="btnVerificarSessao">
          <i class="fa-solid fa-rotate"></i>
          Verificar sessão novamente
        </button>

        <button type="button" class="btn-quiet" id="btnVoltarLogin">
          <i class="fa-solid fa-arrow-left"></i>
          Voltar para a página anterior
        </button>

      </div>

      <div class="erp-login-foot">
        A senha não é solicitada nem armazenada nesta página.
      </div>

    </div>
  `;

  $('#btnVerificarSessao').addEventListener('click', async () => {
    const button = $('#btnVerificarSessao');

    button.disabled = true;

    button.innerHTML = `
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      Verificando...
    `;

    try {
      await checkERPSession();

    } finally {
      if (button.isConnected) {
        button.disabled = false;

        button.innerHTML = `
          <i class="fa-solid fa-rotate"></i>
          Verificar sessão novamente
        `;
      }
    }
  });

  $('#btnVoltarLogin').addEventListener('click', () => {

    if (document.referrer) {
      try {
        const previous = new URL(document.referrer);

        if (
          previous.origin === location.origin &&
          previous.href !== location.href
        ) {
          location.assign(previous.href);
          return;
        }

      } catch {}
    }

    if (history.length > 1) {
      history.back();

    } else {
      toast(
        'Abra a página externa de login administrativo para entrar no ERP.',
        'error'
      );
    }
  });
}

function unlockERP() {
  document.body.classList.add('erp-authenticated');

  const gate = $('#erpLoginGate');

  if (gate) {
    gate.hidden = true;
  }
}

// ======================================================
// LOGOUT
// ======================================================

async function logoutERP() {

  if (appState.dirty) {

    const save = confirm(
      'Há alterações pendentes. Deseja salvar antes de sair?'
    );

    if (save) {
      await saveCurrent(false);

      if (appState.dirty) {
        return toast(
          'Não foi possível salvar. A sessão foi mantida para evitar perda de dados.',
          'error'
        );
      }

    } else if (!confirm(
      'Descartar as alterações não salvas e encerrar a sessão?'
    )) {
      return;
    }
  }

  try {

    await api('/api/erp/logout', {
      method: 'POST'
    });

    renderNoRecord();

    appState.records = [];
    appState.portalClients = [];

    setConnection(false, 'Sessão encerrada');

    showSessionGate(
      'Sessão encerrada. Para entrar novamente, utilize a página externa de acesso.'
    );

  } catch (e) {

    toast(
      e.message || 'Não foi possível encerrar a sessão.',
      'error'
    );
  }
}

// ======================================================
// VERIFICAÇÃO DA SESSÃO
// ======================================================

async function checkERPSession() {

  try {

    setConnection(true, 'Verificando sessão');

    const session = await api('/api/erp/session');

    if (!session?.configured) {

      setConnection(false, 'Acesso não configurado');

      showSessionGate(
        'O acesso ainda não está configurado no servidor. Confira ERP_ADMIN_PASSWORD, ERP_SESSION_SECRET, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.'
      );

      return false;
    }

    if (!session.authenticated) {

      setConnection(false, 'Aguardando login externo');

      showSessionGate(
        'Nenhuma sessão administrativa ativa. Entre pela página externa de login e retorne a esta tela.'
      );

      return false;
    }

    const previousId = appState.current?.id || null;

    unlockERP();

    setConnection(true, 'Acesso autorizado');

    // Se a sessão expirou com alterações pendentes,
    // sincroniza primeiro, sem sobrescrever dados locais.

    if (
      appState.current &&
      appState.data &&
      appState.dirty
    ) {

      await saveCurrent(false);

      if (appState.dirty) {

        showSessionGate(
          'A sessão foi reconhecida, mas ainda existem alterações que não foram salvas. Verifique a conexão e tente novamente.'
        );

        setConnection(false, 'Falha ao sincronizar');

        return false;
      }
    }

    // Preserva a obra que estava aberta antes da expiração.

    await loadInitialData(previousId);

    return true;

  } catch (e) {

    setConnection(false, 'API indisponível');

    showSessionGate(
      'Não foi possível verificar a sessão: ' +
      (e.message || 'API indisponível.')
    );

    return false;
  }
}

// ======================================================
// API CENTRAL
// ======================================================

// credentials same-origin envia automaticamente o cookie
// ph_erp_admin nas chamadas à API do próprio domínio.

async function api(path, options = {}) {

  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,

    headers: {
      Accept: 'application/json',

      ...(options.body
        ? { 'Content-Type': 'application/json' }
        : {}),

      ...(options.headers || {})
    }
  });

  const raw = await res.text();

  let body = null;

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  if (!res.ok) {

    if (
      res.status === 401 &&
      path !== '/api/erp/session' &&
      path !== '/api/erp/logout'
    ) {

      showSessionGate(
        'Sua sessão administrativa expirou. Entre pela página externa de login e retorne a esta tela.'
      );
    }

    const error = new Error(
      body && typeof body === 'object'
        ? (
            body.error ||
            body.message ||
            'Falha na solicitação.'
          )
        : String(body || 'Falha na solicitação.')
    );

    error.status = res.status;

    throw error;
  }

  return body;
}

// ======================================================
// INDICADORES DE CONEXÃO E SALVAMENTO
// ======================================================

function setConnection(ok, label) {

  const el = $('#connectionPill');

  el.className = 'system-pill ' + (ok ? 'online' : 'offline');

  el.innerHTML = `
    <i class="fa-solid ${
      ok
        ? 'fa-circle-check'
        : 'fa-triangle-exclamation'
    }"></i>
    ${esc(label)}
  `;
}

function setSaveState(state, label) {

  const el = $('#saveState');

  el.className = 'save-state ' + (state || '');

  const icon =
    state === 'pending'
      ? 'fa-rotate fa-spin'
      : state === 'error'
        ? 'fa-circle-exclamation'
        : 'fa-circle-check';

  el.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    ${esc(label)}
  `;
}

function setRecordButtons(on) {

  [
    'btnEditarObra',
    'btnExcluirObra',
    'btnSalvar',
    'btnBackup',
    'btnCsv',
    'btnImportBackup'
  ].forEach(id => {
    $('#' + id).disabled = !on;
  });
}

// ======================================================
// UTILITÁRIOS
// ======================================================

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function formatCPF(v) {

  const x = onlyDigits(v);

  return x.length === 11
    ? x.replace(
        /(\d{3})(\d{3})(\d{3})(\d{2})/,
        '$1.$2.$3-$4'
      )
    : (v || '');
}

function validCPF(v) {

  const c = onlyDigits(v);

  if (
    c.length !== 11 ||
    /^(\d)\1{10}$/.test(c)
  ) {
    return false;
  }

  let s = 0;

  for (let i = 0; i < 9; i++) {
    s += Number(c[i]) * (10 - i);
  }

  let digit = (s * 10) % 11;

  if (digit === 10) digit = 0;

  if (digit !== Number(c[9])) return false;

  s = 0;

  for (let i = 0; i < 10; i++) {
    s += Number(c[i]) * (11 - i);
  }

  digit = (s * 10) % 11;

  if (digit === 10) digit = 0;

  return digit === Number(c[10]);
}

function formatDate(v) {

  if (!v) return '—';

  const p = String(v).slice(0, 10).split('-');

  return p.length === 3
    ? `${p[2]}/${p[1]}/${p[0]}`
    : String(v);
}

function dateDiff(v) {

  if (!v) return null;

  const a = new Date(`${v}T00:00:00`);
  const b = new Date(`${todayISO()}T00:00:00`);

  return Math.round((a - b) / 86400000);
}

function recordMeta() {
  return appState.current || {};
}

function selectedWorkCode(cpf) {

  return `PH-${new Date().getFullYear()}-${onlyDigits(cpf).slice(-4)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ======================================================
// CARREGAMENTO DAS OBRAS
// ======================================================

async function loadInitialData(preferredId = null) {

  try {

    setConnection(true, 'Conectando ao banco');

    const [records, clients] = await Promise.all([

      api('/api/erp/obras'),

      api('/api/erp/clientes').catch(() => [])
    ]);

    appState.records = Array.isArray(records)
      ? records
      : [];

    appState.portalClients = Array.isArray(clients)
      ? clients
      : [];

    renderPortalClientOptions();

    renderRecordOptions();

    setConnection(true, 'Banco conectado');

    const target =
      appState.records.find(
        r => String(r.id) === String(preferredId)
      ) ||
      appState.records[0];

    if (target) {

      await openRecord(target.id, {
        skipDirty: true
      });

    } else {

      renderNoRecord();
    }

  } catch (e) {

    setConnection(false, 'Falha no banco');

    toast(e.message, 'error');

    renderNoRecord();
  }
}

function renderRecordOptions() {

  const s = $('#obraSelecionada');

  const sel = appState.current?.id || '';

  s.innerHTML =
    '<option value="">Selecione uma obra</option>' +

    appState.records.map(r => `
      <option
        value="${esc(r.id)}"
        ${String(r.id) === String(sel) ? 'selected' : ''}
      >
        ${esc(r.id_obra)} · ${esc(r.cliente_nome)}
      </option>
    `).join('');
}

function renderPortalClientOptions(selected = '') {

  const s = $('#clienteVinculado');

  s.innerHTML =
    '<option value="">Sem vínculo com portal</option>' +

    appState.portalClients.map(c => `
      <option
        value="${esc(c.id)}"
        ${String(selected) === String(c.id) ? 'selected' : ''}
      >
        ${esc(c.nome)} — ${esc(c.email || 'sem e-mail')}
      </option>
    `).join('');
}

// ======================================================
// ESTADO SEM OBRA SELECIONADA
// ======================================================

function renderNoRecord() {

  clearTimeout(appState.historyTimer);
  clearTimeout(appState.saveTimer);

  appState.pendingAuditLabel = null;

  appState.current = null;
  appState.data = null;
  appState.dirty = false;

  appState.revision++;

  $('#displayObraId').textContent = 'NENHUMA';
  $('#displayCPF').textContent = '—';

  $('#obraStatus').textContent = 'Aguardando seleção';

  $('#obraSelecionada').value = '';

  $('#kpiIdObra').textContent = 'Nenhuma obra selecionada';

  [
    'tbodyComparativo',
    'tbodyFornecedores',
    'tbodyEstoque',
    'tbodyFluxo',
    'tbodyCronogramaFisico',
    'tbodyCompras',
    'tbodyCotacoes',
    'tbodyContas'
  ].forEach(id => {

    $('#' + id).innerHTML = `
      <tr>
        <td colspan="10" class="empty-row">
          Selecione ou cadastre uma obra.
        </td>
      </tr>
    `;
  });

  [
    'tbodyCronograma',
    'checklistCaixa'
  ].forEach(id => {
    $('#' + id).innerHTML = '';
  });

  $('#listaDocumentos').innerHTML = `
    <div class="record-empty">
      <i class="fa-regular fa-folder-open"></i>
      <strong>Selecione uma obra</strong>
      <span>Os documentos serão listados aqui.</span>
    </div>
  `;

  [
    'listaDiario',
    'listaArquivos',
    'listaAtualizacoes',
    'listaHistorico'
  ].forEach(id => {
    $('#' + id).innerHTML = '';
  });

  $('#historicoCount').textContent = '0 eventos';

  [
    'kpiContrato',
    'kpiGasto',
    'kpiSaldo',
    'kpiLucro',
    'kpiOrcado',
    'kpiDesvio',
    'kpiFluxo',
    'kpiProjecao',
    'kpiContasAbertas',
    'resumoContrato',
    'resumoOrcado',
    'resumoGasto',
    'resumoTaxas',
    'resumoSaldo',
    'resumoLucro',
    'caixaJaLiberado',
    'caixaAReceber',
    'totalEntradas',
    'totalSaidas',
    'saldoFluxo',
    'comprasPlanejado',
    'comprasComprado',
    'contasPagar',
    'contasReceber'
  ].forEach(id => {

    const el = $('#' + id);

    if (el) el.textContent = 'R$ 0,00';
  });

  [
    'resumoFornecedores',
    'resumoMateriais',
    'resumoMovimentos',
    'resumoEtapas',
    'resumoDiario',
    'resumoCompras',
    'comprasPendentes',
    'contasVencidas'
  ].forEach(id => {

    const el = $('#' + id);

    if (el) el.textContent = '0';
  });

  $('#progressGasto').style.width = '0%';
  $('#progressFisico').style.width = '0%';

  $('#kpiAvanco').textContent = '0%';

  $('#kpiPctGasto').textContent = '0% do contrato consumido';
  $('#kpiPctRestante').textContent = '0% disponível';
  $('#kpiMargem').textContent = 'Margem planejada 0%';
  $('#kpiDesvioNota').textContent = 'Sem lançamentos';

  $('#dashboardAlertCount').textContent = '0 alertas';

  $('#dashboardAlertsList').innerHTML = `
    <div class="dashboard-alert-item">
      <i class="fa-solid fa-circle-info"></i>
      <span>Selecione uma obra para visualizar os alertas.</span>
    </div>
  `;

  $('#resumoIdObra').textContent = '—';
  $('#cronogramaResumo').textContent = '0% concluído';
  $('#comprasResumo').textContent = '0 itens';
  $('#cotacoesResumo').textContent = '0 cotações';

  $('#cotCompra').innerHTML = `
    <option value="">Cadastre um item de compra primeiro</option>
  `;

  $('#diarioCount').textContent = '0 registros';

  $('#alertaEstouro').style.display = 'none';

  setRecordButtons(false);

  setSaveState('', 'Nenhuma alteração pendente');

  updateCaixaVisibility();
}

// ======================================================
// ABRIR OBRA
// ======================================================

async function openRecord(id, opts = {}) {

  if (!id) return renderNoRecord();

  if (appState.dirty && !opts.skipDirty) {

    const save = confirm(
      'Há alterações pendentes nesta obra. Deseja salvar antes de trocar?\n\nOK = salvar e trocar. Cancelar = permanecer nesta obra.'
    );

    if (!save) return;

    await saveCurrent(false);

    if (appState.dirty) {
      return toast(
        'Não foi possível sincronizar as alterações. A troca foi cancelada.',
        'error'
      );
    }
  }

  try {

    setSaveState('pending', 'Carregando obra...');

    const r = await api(
      '/api/erp/obras/' + encodeURIComponent(id)
    );

    appState.current = r;

    appState.data = mergeData(r.dados || {}, {});

    appState.dirty = false;

    appState.revision++;

    renderRecordOptions();

    hydrateMeta();

    renderAll();

    await loadLinkedPortalData();

    setRecordButtons(true);

    setSaveState('', 'Dados sincronizados');

  } catch (e) {

    toast(e.message, 'error');

    setSaveState('error', 'Falha ao carregar');
  }
}

function hydrateMeta() {

  const r = recordMeta();

  $('#displayObraId').textContent = r.id_obra || '—';

  $('#displayCPF').textContent = formatCPF(r.cpf || '');

  $('#obraStatus').textContent = r.status || 'Em andamento';

  $('#resumoIdObra').textContent = r.id_obra || '—';

  $('#kpiIdObra').textContent = r.id_obra || '—';

  $('#obraSelecionada').value = r.id || '';
}

// ======================================================
// MODAL DE CADASTRO / EDIÇÃO
// ======================================================

function openNewModal(record = null) {

  appState.editId = record?.id || null;

  $('#obraForm').reset();

  $('#obraFormError').classList.remove('show');

  $('#obraFormError').textContent = '';

  $('#modalObraTitulo').textContent = record
    ? 'Editar cadastro da obra'
    : 'Cadastrar nova obra';

  $('#btnCriarObra').innerHTML = record
    ? '<i class="fa-solid fa-floppy-disk"></i> Salvar cadastro'
    : '<i class="fa-solid fa-check"></i> Criar obra';

  renderPortalClientOptions(record?.cliente_id || '');

  if (record) {

    const meta = record.dados?.meta || {};

    $('#nomeCliente').value = record.cliente_nome || '';

    $('#cpfCliente').value = formatCPF(record.cpf || '');

    $('#telCliente').value = record.telefone || '';

    $('#enderecoObra').value = record.endereco || '';

    $('#clienteVinculado').value = record.cliente_id || '';

    $('#tipoObraCadastro').value = record.tipo || 'particular';

    $('#statusObra').value = record.status || 'Em andamento';

    $('#idObraPreview').value = record.id_obra || '—';

    $('#metragemTerreno').value = meta.metragem_terreno || '';

    $('#metragemConstrucao').value = meta.metragem_construcao || '';

    $('#dataInicio').value = record.data_inicio || '';

    $('#valorContrato').value = record.valor_contrato || 0;

    $('#margemLucro').value = meta.margem_lucro ?? 20;

    $('#prazoObra').value = meta.prazo_meses || '';

    $('#caixaContrato').value = meta.caixa_contrato || '';

    $('#caixaValor').value = meta.caixa_valor || '';

    $('#caixaEng').value = meta.caixa_engenheiro || '';

  } else {

    $('#tipoObraCadastro').value = 'particular';

    $('#statusObra').value = 'Em andamento';

    $('#idObraPreview').value = 'Gerado automaticamente';

    $('#margemLucro').value = 20;

    $('#dataInicio').value = todayISO();
  }

  updateCaixaFormVisibility();

  $('#modalObra').classList.add('active');

  $('#modalObra').setAttribute('aria-hidden', 'false');
}

function closeModal() {

  $('#modalObra').classList.remove('active');

  $('#modalObra').setAttribute('aria-hidden', 'true');

  appState.editId = null;
}

function updateCaixaFormVisibility() {

  $('#boxCaixaCadastro').style.display =
    ['caixa', 'mcmv'].includes($('#tipoObraCadastro').value)
      ? 'block'
      : 'none';
}

function hasCaixaFinancing(r = appState.current) {

  return ['caixa', 'mcmv'].includes(
    String(r?.tipo || '').toLowerCase()
  );
}

function updateCaixaVisibility() {

  const enabled = hasCaixaFinancing();

  const b = $('#erpNavigation [data-view="caixa"]');

  const s = $('#caixa');

  b.hidden = !enabled;

  s.hidden = !enabled;

  if (!enabled && getViewFromUrl() === 'caixa') {
    navigateToView('visao-geral', { scroll: false });
  }

  $('#painelCaixa').querySelectorAll('input,button').forEach(el => {

    if (el.id !== 'btnResetCronograma') {
      el.disabled = !enabled;
    }
  });
}

// ======================================================
// SALVAR CADASTRO DA OBRA
// ======================================================

async function submitWorkForm(ev) {

  ev.preventDefault();

  const box = $('#obraFormError');

  box.classList.remove('show');

  const cpf = onlyDigits($('#cpfCliente').value);

  const name = $('#nomeCliente').value.trim();

  if (!validCPF(cpf)) {

    box.textContent = 'CPF inválido. Confira os 11 dígitos informados.';

    box.classList.add('show');

    return;
  }

  if (!name) {

    box.textContent = 'Informe o nome do cliente.';

    box.classList.add('show');

    return;
  }

  const btn = $('#btnCriarObra');

  btn.disabled = true;

  const prev = appState.editId
    ? appState.current
    : null;

  const d = prev
    ? mergeData(appState.data, {})
    : emptyData();

  d.meta = {
    ...d.meta,

    margem_lucro: n($('#margemLucro').value),

    prazo_meses: n($('#prazoObra').value),

    metragem_terreno: n($('#metragemTerreno').value),

    metragem_construcao: n($('#metragemConstrucao').value),

    caixa_contrato: $('#caixaContrato').value.trim(),

    caixa_valor: n($('#caixaValor').value),

    caixa_engenheiro: $('#caixaEng').value.trim()
  };

  const payload = {

    id_obra: prev?.id_obra || selectedWorkCode(cpf),

    cpf,

    cliente_nome: name,

    telefone: $('#telCliente').value.trim(),

    endereco: $('#enderecoObra').value.trim(),

    tipo: $('#tipoObraCadastro').value,

    data_inicio: $('#dataInicio').value || null,

    valor_contrato: n($('#valorContrato').value),

    cliente_id: $('#clienteVinculado').value || null,

    status: $('#statusObra').value || 'Em andamento',

    dados: d
  };

  try {

    const result = prev

      ? await api(
          '/api/erp/obras/' + encodeURIComponent(prev.id),
          {
            method: 'PUT',
            body: JSON.stringify(payload)
          }
        )

      : await api('/api/erp/obras', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

    closeModal();

    await loadInitialData();

    if (result?.id) {
      await openRecord(result.id, { skipDirty: true });
    }

    toast(
      prev
        ? 'Cadastro atualizado.'
        : 'Obra cadastrada com sucesso.',
      'success'
    );

  } catch (e) {

    box.textContent = e.message;

    box.classList.add('show');

  } finally {

    btn.disabled = false;

    btn.innerHTML = prev
      ? '<i class="fa-solid fa-floppy-disk"></i> Salvar cadastro'
      : '<i class="fa-solid fa-check"></i> Criar obra';
  }
}

// ======================================================
// PERSISTÊNCIA / SALVAMENTO AUTOMÁTICO
// ======================================================

function currentPayload() {

  const r = appState.current;

  return {

    id_obra: r.id_obra,

    cpf: r.cpf,

    cliente_nome: r.cliente_nome,

    telefone: r.telefone || '',

    endereco: r.endereco || '',

    tipo: r.tipo || 'particular',

    data_inicio: r.data_inicio || null,

    valor_contrato: n(r.valor_contrato),

    cliente_id: r.cliente_id || null,

    status: r.status || 'Em andamento',

    dados: appState.data
  };
}

function flushHistory() {

  clearTimeout(appState.historyTimer);

  appState.historyTimer = null;

  if (!appState.pendingAuditLabel || !appState.data) return;

  const label = appState.pendingAuditLabel;

  appState.pendingAuditLabel = null;

  appState.data.historico.unshift({

    id: makeId(),

    data: new Date().toISOString(),

    evento: label,

    origem: 'Painel administrativo'
  });

  appState.data.historico =
    appState.data.historico.slice(0, 300);

  appState.revision++;

  renderHistorico();
}

function markDirty(label = 'Edição de informações') {

  if (!appState.current || !appState.data) return;

  appState.revision++;

  appState.dirty = true;

  appState.pendingAuditLabel = label;

  setSaveState('pending', label);

  updateKpis();

  clearTimeout(appState.historyTimer);

  appState.historyTimer = setTimeout(flushHistory, 650);

  clearTimeout(appState.saveTimer);

  appState.saveTimer = setTimeout(
    () => saveCurrent(false),
    1250
  );
}

async function saveCurrent(showMessage = true) {

  if (
    !appState.current ||
    !appState.data ||
    appState.saving ||
    !appState.dirty
  ) {
    return;
  }

  flushHistory();

  appState.saving = true;

  const id = appState.current.id;

  const rev = appState.revision;

  const payload = currentPayload();

  setSaveState(
    'pending',
    'Sincronizando com o Supabase...'
  );

  $('#btnSalvar').disabled = true;

  let ok = false;

  try {

    const result = await api(
      '/api/erp/obras/' + encodeURIComponent(id),
      {
        method: 'PUT',
        body: JSON.stringify(payload)
      }
    );

    ok = true;

    if (appState.current?.id === id) {

      appState.current = result || appState.current;

      appState.records = appState.records.map(r =>
        String(r.id) === String(id)
          ? appState.current
          : r
      );

      renderRecordOptions();

      if (appState.revision === rev) {

        appState.dirty = false;

        setSaveState(
          '',
          'Salvo na nuvem · ' +
          new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
          })
        );

        if (showMessage) {
          toast(
            'Dados da obra salvos no Supabase.',
            'success'
          );
        }

      } else {

        appState.dirty = true;

        setSaveState(
          'pending',
          'Novas alterações · sincronizando...'
        );
      }
    }

  } catch (e) {

    setSaveState(
      'error',
      'Falha ao salvar · ' + e.message
    );

    toast(
      'Não foi possível salvar: ' + e.message,
      'error'
    );

  } finally {

    appState.saving = false;

    $('#btnSalvar').disabled = !appState.current;

    if (
      ok &&
      appState.dirty &&
      appState.current?.id === id
    ) {

      clearTimeout(appState.saveTimer);

      appState.saveTimer = setTimeout(
        () => saveCurrent(false),
        350
      );
    }
  }
}

// ======================================================
// COLEÇÕES E REGISTROS
// ======================================================

function collection(path) {

  return path.split('.').reduce(
    (o, k) => o?.[k],
    appState.data
  );
}

function addItem(path, item) {

  const a = collection(path);

  if (!Array.isArray(a)) {
    return toast('Coleção não encontrada.', 'error');
  }

  a.push(item);

  renderAll();

  markDirty('Novo registro adicionado');
}

function removeItem(path, index) {

  const a = collection(path);

  if (!Array.isArray(a)) return;

  if (path === 'compras') {

    const item = a[Number(index)];

    if (item) {
      appState.data.cotacoes =
        appState.data.cotacoes.filter(
          q => String(q.compraId) !== String(item.id)
        );
    }
  }

  a.splice(Number(index), 1);

  renderAll();

  markDirty('Registro removido');
}

// ======================================================
// RENDERIZAÇÃO GERAL
// ======================================================

function renderAll() {

  if (!appState.current || !appState.data) {
    return renderNoRecord();
  }

  hydrateMeta();

  renderComparativo();

  renderCaixa();

  renderFornecedores();

  renderEstoque();

  renderFluxo();

  renderDocuments();

  renderCronograma();

  renderDiario();

  renderCompras();

  renderCotacoes();

  renderContas();

  renderHistorico();

  updateKpis();

  updateCaixaVisibility();
}

function renderComparativo() {

  const rows = appState.data.financeiro.etapas;

  $('#tbodyComparativo').innerHTML = rows.length

    ? rows.map((r, i) => {

        const b = n(r.orcado);

        const a = n(r.realizado);

        const diff = b - a;

        const pct = b > 0
          ? Math.min(100, a / b * 100)
          : 0;

        return `
          <tr>

            <td class="col-name">
              <input
                data-collection="financeiro.etapas"
                data-index="${i}"
                data-key="nome"
                value="${esc(r.nome)}"
                aria-label="Etapa"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                data-collection="financeiro.etapas"
                data-index="${i}"
                data-key="orcado"
                value="${b || ''}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                data-collection="financeiro.etapas"
                data-index="${i}"
                data-key="realizado"
                value="${a || ''}"
              >
            </td>

            <td style="
              font-family:var(--font-mono);
              color:${diff < 0 ? '#b66e67' : '#718a69'}
            ">
              ${money(diff)}
            </td>

            <td>
              <div class="progress-track">
                <div
                  class="progress-fill"
                  style="width:${pct}%"
                ></div>
              </div>

              <small>
                ${b ? pct.toFixed(0) + '%' : 'Sem orçamento'}
              </small>
            </td>

            <td>
              <button
                type="button"
                class="btn-danger btn-small"
                data-remove="financeiro.etapas"
                data-index="${i}"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="6" class="empty-row">
          Nenhuma etapa cadastrada.
        </td>
      </tr>
    `;

  $('#taxasObra').value = n(appState.data.financeiro.taxas);

  $('#observacaoFinanceira').value =
    appState.data.financeiro.observacao || '';

  updateBudgetAlert();
}

function renderCaixa() {

  const c = appState.data.caixa;

  $('#caixaPercentLiberado').value =
    n(c.percentualLiberado);

  $('#caixaProximaMedicao').value =
    c.proximaMedicao || '';

  $('#checklistCaixa').innerHTML =
    caixaChecklistItems.map((x, i) => `
      <label>
        <input
          type="checkbox"
          data-scope="caixa.checklist"
          data-key="${i}"
          ${c.checklist[i] ? 'checked' : ''}
        >
        ${esc(x)}
      </label>
    `).join('');

  $('#tbodyCronograma').innerHTML =
    c.cronograma.map((x, i) => `
      <tr>

        <td>${esc(x.etapa)}</td>

        <td>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            data-collection="caixa.cronograma"
            data-index="${i}"
            data-key="percentual"
            value="${n(x.percentual)}"
          >
        </td>

        <td>
          ${money(
            n(recordMeta().valor_contrato) *
            n(x.percentual) / 100
          )}
        </td>

        <td>
          <input
            type="date"
            data-collection="caixa.cronograma"
            data-index="${i}"
            data-key="data"
            value="${esc(x.data || '')}"
          >
        </td>

      </tr>
    `).join('');

  calculateCaixa();
}

function supplierScore(x) {

  const has =
    x.nota !== '' &&
    x.nota !== null &&
    x.nota !== undefined &&
    Number.isFinite(Number(x.nota));

  const score = has ? n(x.nota) : null;

  const delay = n(x.atraso);

  if (!has && !delay) {
    return {
      className: 'none',
      label: 'Sem avaliação'
    };
  }

  if (
    (score !== null && score < 6) ||
    delay > 5
  ) {
    return {
      className: 'low',
      label: 'Baixo'
    };
  }

  if (
    (score !== null && score < 8) ||
    delay > 2
  ) {
    return {
      className: 'mid',
      label: 'Médio'
    };
  }

  return {
    className: 'high',
    label: 'Alto'
  };
}

function renderFornecedores() {

  const a = appState.data.fornecedores;

  $('#tbodyFornecedores').innerHTML = a.length

    ? a.map((x, i) => {

        const s = supplierScore(x);

        return `
          <tr>

            <td>
              <input
                data-collection="fornecedores"
                data-index="${i}"
                data-key="empresa"
                value="${esc(x.empresa || '')}"
              >
            </td>

            <td>
              <input
                data-collection="fornecedores"
                data-index="${i}"
                data-key="cnpj"
                value="${esc(x.cnpj || '')}"
              >
            </td>

            <td>
              <input
                data-collection="fornecedores"
                data-index="${i}"
                data-key="servico"
                value="${esc(x.servico || '')}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                data-collection="fornecedores"
                data-index="${i}"
                data-key="valor"
                value="${n(x.valor) || ''}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                data-collection="fornecedores"
                data-index="${i}"
                data-key="atraso"
                value="${n(x.atraso)}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                max="10"
                step="0.1"
                data-collection="fornecedores"
                data-index="${i}"
                data-key="nota"
                value="${x.nota ?? ''}"
              >
            </td>

            <td>
              <span class="score ${s.className}">
                ${s.label}
              </span>
            </td>

            <td>
              <button
                type="button"
                class="btn-danger btn-small"
                data-remove="fornecedores"
                data-index="${i}"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="8" class="empty-row">
          Nenhum fornecedor cadastrado.
        </td>
      </tr>
    `;

  const low = a.filter(
    x => supplierScore(x).className === 'low'
  ).length;

  $('#alertasFornecedor').innerHTML = low

    ? `
      <div class="pill-alert">
        Atenção: ${low} fornecedor(es) com avaliação baixa ou atraso superior a 5 dias.
      </div>
    `

    : '';
}

function renderEstoque() {

  const a = appState.data.estoque;

  $('#tbodyEstoque').innerHTML = a.length

    ? a.map((x, i) => {

        const bal = n(x.comprado) - n(x.utilizado);

        const pct = n(x.comprado) > 0
          ? n(x.utilizado) / n(x.comprado) * 100
          : 0;

        const al = bal < 0

          ? ['out', 'Estoque negativo']

          : bal <= n(x.comprado) * .2
            ? ['low', 'Reposição']
            : ['', 'Normal'];

        return `
          <tr>

            <td>
              <input
                data-collection="estoque"
                data-index="${i}"
                data-key="material"
                value="${esc(x.material || '')}"
              >
            </td>

            <td>
              <select
                data-collection="estoque"
                data-index="${i}"
                data-key="unidade"
              >
                ${
                  ['un','saco','kg','barra','m','m³','m²','L','rolo']
                    .map(u => `
                      <option
                        value="${u}"
                        ${x.unidade === u ? 'selected' : ''}
                      >
                        ${u}
                      </option>
                    `).join('')
                }
              </select>
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                data-collection="estoque"
                data-index="${i}"
                data-key="comprado"
                value="${n(x.comprado) || ''}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                data-collection="estoque"
                data-index="${i}"
                data-key="utilizado"
                value="${n(x.utilizado) || ''}"
              >
            </td>

            <td>
              ${bal.toLocaleString('pt-BR')}
              ${esc(x.unidade || 'un')}
            </td>

            <td>${pct.toFixed(1)}%</td>

            <td>
              <span class="stock-alert ${al[0]}">
                ${al[1]}
              </span>
            </td>

            <td>
              <button
                type="button"
                class="btn-danger btn-small"
                data-remove="estoque"
                data-index="${i}"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="8" class="empty-row">
          Nenhum material cadastrado.
        </td>
      </tr>
    `;
}

// ======================================================
// FLUXO DE CAIXA
// ======================================================

function renderFluxo() {

  const a = [...appState.data.fluxo].sort(
    (x, y) => String(x.data).localeCompare(String(y.data))
  );

  let bal = 0;
  let ent = 0;
  let sai = 0;

  $('#tbodyFluxo').innerHTML = a.length

    ? a.map(x => {

        const v = n(x.valor);

        if (x.tipo === 'entrada') {
          bal += v;
          ent += v;
        } else {
          bal -= v;
          sai += v;
        }

        return `
          <tr>

            <td>${formatDate(x.data)}</td>

            <td>
              <span class="tag-muted">
                ${x.tipo === 'entrada' ? 'Entrada' : 'Saída'}
              </span>
            </td>

            <td>${esc(x.descricao)}</td>

            <td style="
              color:${x.tipo === 'entrada' ? '#718a69' : '#b66e67'}
            ">
              ${x.tipo === 'entrada' ? '+' : '−'}
              ${money(v)}
            </td>

            <td>${money(bal)}</td>

            <td>
              <button
                type="button"
                class="btn-danger btn-small"
                data-flow-delete="${esc(x.id)}"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="6" class="empty-row">
          Nenhuma movimentação registrada.
        </td>
      </tr>
    `;

  $('#totalEntradas').textContent = money(ent);
  $('#totalSaidas').textContent = money(sai);
  $('#saldoFluxo').textContent = money(bal);
  $('#kpiFluxo').textContent = money(bal);

  appState.flowTotals = {
    ent,
    sai,
    bal
  };
}

// ======================================================
// DOCUMENTOS
// ======================================================

function renderDocuments() {

  const all = [

    ...appState.data.contratos.map(x => ({
      ...x,
      kind: 'Contrato'
    })),

    ...appState.data.recibos.map(x => ({
      ...x,
      kind: 'Recibo'
    })),

    ...appState.data.extras.map(x => ({
      ...x,
      kind: 'Orçamento extra'
    }))

  ].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );

  $('#listaDocumentos').innerHTML = all.length

    ? `
      <div class="record-list">

        ${
          all.map(x => `
            <div class="record-chip">

              <span>
                <strong>${x.kind}</strong>
                · ${esc(x.titulo || x.nome || x.descricao || '')}

                <br>

                <small>
                  ${formatDate((x.created_at || '').slice(0, 10) || x.data)}
                  ·
                  ${money(x.valor)}
                </small>
              </span>

              <button
                type="button"
                data-doc-pdf="${esc(x.id)}"
                data-doc-kind="${x.kind}"
                title="Gerar PDF"
              >
                <i class="fa-solid fa-download"></i>
              </button>

            </div>
          `).join('')
        }

      </div>
    `

    : `
      <div class="record-empty">
        <i class="fa-regular fa-folder-open"></i>
        <strong>Nenhum documento registrado</strong>
        <span>Use os formulários para criar contratos, recibos ou extras.</span>
      </div>
    `;

  $('#resumoFornecedores').textContent =
    appState.data.fornecedores.length;

  $('#resumoMateriais').textContent =
    appState.data.estoque.length;

  $('#resumoMovimentos').textContent =
    appState.data.fluxo.length;
}

// ======================================================
// CRONOGRAMA FÍSICO
// ======================================================

function weightedProgress() {

  const a = appState.data?.cronogramaFisico || [];

  if (!a.length) return 0;

  const total = a.reduce(
    (s, x) => s + n(x.peso),
    0
  );

  if (!total) {

    return a.reduce(
      (s, x) => s + n(x.avanco),
      0
    ) / a.length;
  }

  return a.reduce(
    (s, x) => s + n(x.peso) * n(x.avanco) / 100,
    0
  ) / total * 100;
}

function scheduleStatus(x) {

  if (n(x.avanco) >= 100) {
    return {
      label: 'Concluída',
      cls: 'high'
    };
  }

  const days = dateDiff(x.fim);

  if (days !== null && days < 0) {
    return {
      label: 'Atrasada',
      cls: 'low'
    };
  }

  if (days !== null && days <= 7) {
    return {
      label: 'Atenção',
      cls: 'mid'
    };
  }

  return {
    label: 'No prazo',
    cls: 'high'
  };
}

function renderCronograma() {

  const a = appState.data.cronogramaFisico;

  $('#tbodyCronogramaFisico').innerHTML = a.length

    ? a.map((x, i) => {

        const st = scheduleStatus(x);

        return `
          <tr>

            <td>
              <input
                data-collection="cronogramaFisico"
                data-index="${i}"
                data-key="nome"
                value="${esc(x.nome)}"
              >
            </td>

            <td>
              <input
                type="date"
                data-collection="cronogramaFisico"
                data-index="${i}"
                data-key="inicio"
                value="${esc(x.inicio || '')}"
              >
            </td>

            <td>
              <input
                type="date"
                data-collection="cronogramaFisico"
                data-index="${i}"
                data-key="fim"
                value="${esc(x.fim || '')}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                data-collection="cronogramaFisico"
                data-index="${i}"
                data-key="peso"
                value="${n(x.peso)}"
              >
            </td>

            <td>
              <div class="schedule-progress">

                <div class="progress-track">
                  <div
                    class="progress-fill"
                    style="width:${Math.min(100, Math.max(0, n(x.avanco)))}%"
                  ></div>
                </div>

                <input
                  type="number"
                  min="0"
                  max="100"
                  data-collection="cronogramaFisico"
                  data-index="${i}"
                  data-key="avanco"
                  value="${n(x.avanco)}"
                >

              </div>
            </td>

            <td>
              <input
                data-collection="cronogramaFisico"
                data-index="${i}"
                data-key="responsavel"
                value="${esc(x.responsavel || '')}"
              >
            </td>

            <td>
              <span class="score ${st.cls}">
                ${st.label}
              </span>
            </td>

            <td>
              <button
                type="button"
                class="btn-danger btn-small"
                data-remove="cronogramaFisico"
                data-index="${i}"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="8" class="empty-row">
          Nenhuma etapa no cronograma. Adicione as fases da execução acima.
        </td>
      </tr>
    `;

  const p = weightedProgress();

  $('#cronogramaResumo').textContent =
    p.toFixed(1) + '% concluído';

  $('#resumoEtapas').textContent = a.length;
}

// ======================================================
// DIÁRIO DE OBRA
// ======================================================

function renderDiario() {

  const a = [...appState.data.diario].sort(
    (x, y) => String(y.data).localeCompare(String(x.data))
  );

  $('#diarioCount').textContent =
    a.length + ' registros';

  $('#resumoDiario').textContent = a.length;

  $('#listaDiario').innerHTML = a.length

    ? `
      <div class="record-list">

        ${
          a.map(x => `
            <div class="record-chip" style="display:block">

              <div style="
                display:flex;
                justify-content:space-between;
                gap:10px
              ">

                <strong>
                  ${formatDate(x.data)}
                  ·
                  ${esc(x.clima || 'Clima não informado')}
                </strong>

                <button
                  type="button"
                  class="btn-danger btn-small"
                  data-remove="diario"
                  data-index="${appState.data.diario.indexOf(x)}"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>

              </div>

              <small>
                ${esc(x.equipe || 'Equipe não informada')}
                ·
                ${esc(x.responsavel || '')}
              </small>

              <p style="
                margin-top:7px;
                white-space:pre-wrap;
                line-height:1.5
              ">
                ${esc(x.atividades)}
              </p>

              ${
                x.ocorrencias
                  ? `<p class="muted-note"><strong>Ocorrências:</strong> ${esc(x.ocorrencias)}</p>`
                  : ''
              }

              ${
                x.proximos
                  ? `<p class="muted-note"><strong>Próximos passos:</strong> ${esc(x.proximos)}</p>`
                  : ''
              }

              ${
                x.fotoUrl
                  ? `<p><a href="${esc(x.fotoUrl)}" target="_blank" rel="noopener">Abrir foto / evidência</a></p>`
                  : ''
              }

            </div>
          `).join('')
        }

      </div>
    `

    : `
      <div class="record-empty">
        <i class="fa-solid fa-clipboard-list"></i>
        <strong>Diário ainda sem registros</strong>
        <span>Inclua a primeira atualização de campo.</span>
      </div>
    `;
}

// ======================================================
// COMPRAS E COTAÇÕES
// ======================================================

function renderCotacaoOptions() {

  const select = $('#cotCompra');

  const current = select.value;

  const active = appState.data.compras.filter(
    x => x.status !== 'Cancelada'
  );

  select.innerHTML = active.length

    ? '<option value="">Selecione o item de compra</option>' +

      active.map(x => `
        <option value="${esc(x.id)}">
          ${esc(x.material)}
          ·
          ${n(x.quantidade).toLocaleString('pt-BR')}
          ${esc(x.unidade || 'un')}
        </option>
      `).join('')

    : '<option value="">Cadastre um item de compra primeiro</option>';

  if (
    active.some(x => String(x.id) === String(current))
  ) {
    select.value = current;
  }
}

function renderCompras() {

  const a = appState.data.compras;

  const q = ($('#filtroCompras')?.value || '').toLowerCase();

  const status = $('#filtroStatusCompra')?.value || '';

  const visible = a.filter(x =>
    (
      !q ||
      `${x.material} ${x.fornecedor}`.toLowerCase().includes(q)
    ) &&
    (!status || x.status === status)
  );

  $('#tbodyCompras').innerHTML = visible.length

    ? visible.map(x => {

        const i = a.indexOf(x);

        const quotes = appState.data.cotacoes.filter(
          c => String(c.compraId) === String(x.id)
        );

        const valid = quotes
          .filter(c => n(c.preco) > 0)
          .sort((u, v) => n(u.preco) - n(v.preco));

        const best = valid[0];

        const quoteLabel = quotes.length
          ? `${quotes.length} proposta(s)${best ? ` · menor ${money(best.preco)}` : ''}`
          : 'Sem cotações';

        return `
          <tr>

            <td>
              <input
                data-collection="compras"
                data-index="${i}"
                data-key="material"
                value="${esc(x.material)}"
              >
            </td>

            <td>
              <select
                data-collection="compras"
                data-index="${i}"
                data-key="categoria"
              >
                ${
                  [
                    'Materiais básicos',
                    'Estrutura',
                    'Alvenaria',
                    'Acabamento',
                    'Elétrica',
                    'Hidráulica',
                    'Impermeabilização',
                    'Ferramentas / equipamentos',
                    'Serviços',
                    'Outros'
                  ].map(v => `
                    <option ${x.categoria === v ? 'selected' : ''}>
                      ${v}
                    </option>
                  `).join('')
                }
              </select>
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.001"
                data-collection="compras"
                data-index="${i}"
                data-key="quantidade"
                value="${n(x.quantidade)}"
              >
            </td>

            <td>
              <input
                data-collection="compras"
                data-index="${i}"
                data-key="unidade"
                value="${esc(x.unidade || 'un')}"
              >
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                data-collection="compras"
                data-index="${i}"
                data-key="preco"
                value="${n(x.preco)}"
              >
            </td>

            <td>
              ${money(n(x.quantidade) * n(x.preco))}
            </td>

            <td>
              <input
                data-collection="compras"
                data-index="${i}"
                data-key="fornecedor"
                value="${esc(x.fornecedor || '')}"
              >
            </td>

            <td>
              <span class="field-help">
                ${esc(quoteLabel)}
              </span>

              ${
                best
                  ? `<button type="button" class="btn-quiet btn-small" data-use-quote="${esc(best.id)}">Aplicar menor</button>`
                  : ''
              }
            </td>

            <td>
              <input
                type="date"
                data-collection="compras"
                data-index="${i}"
                data-key="data"
                value="${esc(x.data || '')}"
              >
            </td>

            <td>
              <select
                data-collection="compras"
                data-index="${i}"
                data-key="status"
              >
                ${
                  [
                    'Planejada',
                    'Em cotação',
                    'Aprovada',
                    'Comprada',
                    'Recebida',
                    'Cancelada'
                  ].map(v => `
                    <option ${x.status === v ? 'selected' : ''}>
                      ${v}
                    </option>
                  `).join('')
                }
              </select>
            </td>

            <td>
              <button
                type="button"
                class="btn-danger btn-small"
                data-remove="compras"
                data-index="${i}"
                aria-label="Remover item"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="11" class="empty-row">
          Nenhum item encontrado.
        </td>
      </tr>
    `;

  const active = a.filter(x => x.status !== 'Cancelada');

  const planned = active.reduce(
    (sum, x) => sum + n(x.quantidade) * n(x.preco),
    0
  );

  const bought = a
    .filter(x => ['Comprada', 'Recebida'].includes(x.status))
    .reduce(
      (sum, x) => sum + n(x.quantidade) * n(x.preco),
      0
    );

  const pending = a.filter(
    x => !['Recebida', 'Cancelada'].includes(x.status)
  ).length;

  $('#comprasPlanejado').textContent = money(planned);

  $('#comprasComprado').textContent = money(bought);

  $('#comprasPendentes').textContent = pending;

  $('#comprasResumo').textContent = a.length + ' itens';

  $('#resumoCompras').textContent = a.length;

  renderCotacaoOptions();
}

function renderCotacoes() {

  if (!appState.data) return;

  const a = appState.data.cotacoes || [];

  const items = new Map(
    appState.data.compras.map(x => [String(x.id), x])
  );

  const sorted = [...a].sort((x, y) => {

    const ax = items.get(String(x.compraId))?.material || '';

    const ay = items.get(String(y.compraId))?.material || '';

    return ax.localeCompare(ay, 'pt-BR') ||
      n(x.preco) - n(y.preco);
  });

  $('#tbodyCotacoes').innerHTML = sorted.length

    ? sorted.map(x => {

        const item = items.get(String(x.compraId));

        return `
          <tr>

            <td>
              ${esc(item?.material || 'Item removido')}
            </td>

            <td>
              ${esc(x.fornecedor || '—')}
            </td>

            <td>
              ${money(x.preco)}
            </td>

            <td>
              ${esc(x.prazoEntrega || '—')}
            </td>

            <td>
              ${formatDate(x.validade)}
            </td>

            <td>
              ${esc(x.condicoes || '—')}
            </td>

            <td>

              <div class="inline-actions">

                <button
                  type="button"
                  class="btn-quiet btn-small"
                  data-use-quote="${esc(x.id)}"
                  ${!item ? 'disabled' : ''}
                >
                  Aplicar
                </button>

                <button
                  type="button"
                  class="btn-danger btn-small"
                  data-remove="cotacoes"
                  data-index="${a.indexOf(x)}"
                  aria-label="Excluir cotação"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>

              </div>

            </td>

          </tr>
        `;

      }).join('')

    : `
      <tr>
        <td colspan="7" class="empty-row">
          Nenhuma cotação registrada.
        </td>
      </tr>
    `;

  $('#cotacoesResumo').textContent =
    a.length + ' cotações';
}

function addCotacao(ev) {

  ev.preventDefault();

  const compraId = $('#cotCompra').value;

  const fornecedor = $('#cotFornecedor').value.trim();

  const preco = n($('#cotPreco').value);

  const item = appState.data.compras.find(
    x => String(x.id) === String(compraId)
  );

  if (!item) {
    return toast('Selecione um item de compra válido.', 'error');
  }

  if (!fornecedor || preco <= 0) {
    return toast(
      'Informe fornecedor e preço unitário válido.',
      'error'
    );
  }

  addItem('cotacoes', {

    id: makeId(),

    compraId: item.id,

    fornecedor,

    preco,

    prazoEntrega: $('#cotPrazo').value.trim(),

    validade: $('#cotValidade').value,

    condicoes: $('#cotCondicoes').value.trim(),

    created_at: new Date().toISOString()
  });

  $('#cotacaoForm').reset();

  renderCotacaoOptions();

  $('#cotCompra').value = String(item.id);
}

function applyCotacao(id) {

  const quote = appState.data.cotacoes.find(
    x => String(x.id) === String(id)
  );

  const item = quote && appState.data.compras.find(
    x => String(x.id) === String(quote.compraId)
  );

  if (!quote || !item) {
    return toast(
      'A cotação ou o item relacionado não foi encontrado.',
      'error'
    );
  }

  if (!confirm(
    `Aplicar a proposta de ${quote.fornecedor} por ${money(quote.preco)} por unidade ao item "${item.material}"?`
  )) {
    return;
  }

  item.fornecedor = quote.fornecedor;

  item.preco = n(quote.preco);

  if (!['Comprada', 'Recebida'].includes(item.status)) {
    item.status = 'Aprovada';
  }

  if (quote.prazoEntrega) {
    item.observacao = [
      item.observacao,
      `Prazo cotado: ${quote.prazoEntrega}`
    ].filter(Boolean).join(' · ');
  }

  renderAll();

  markDirty('Cotação aplicada ao planejamento de compras');

  toast(
    'Fornecedor e preço atualizados no item de compra.',
    'success'
  );
}

// ======================================================
// CONTAS A PAGAR / RECEBER
// ======================================================

function accountIsOpen(x) {
  return x.status !== 'paga' && x.status !== 'recebida';
}

function renderContas() {

  const a = appState.data.contas;

  $('#tbodyContas').innerHTML = a.length

    ? [...a]
        .sort((x, y) =>
          String(x.vencimento).localeCompare(String(y.vencimento))
        )
        .map(x => {

          const i = a.indexOf(x);

          const type =
            x.tipo === 'pagar'
              ? 'Pagar'
              : 'Receber';

          const status =
            x.status === 'paga'
              ? 'Paga'
              : x.status === 'recebida'
                ? 'Recebida'
                : 'Em aberto';

          const days = dateDiff(x.vencimento);

          const late =
            accountIsOpen(x) &&
            days !== null &&
            days < 0;

          return `
            <tr>

              <td>${type}</td>

              <td>${esc(x.descricao)}</td>

              <td>${esc(x.favorecido || '—')}</td>

              <td>${esc(x.categoria || '—')}</td>

              <td style="color:${late ? '#b66e67' : ''}">
                ${formatDate(x.vencimento)}
                ${late ? ' · vencida' : ''}
              </td>

              <td>
                ${money(x.valor)}
              </td>

              <td>
                <span class="score ${
                  late
                    ? 'low'
                    : accountIsOpen(x)
                      ? 'mid'
                      : 'high'
                }">
                  ${status}
                </span>
              </td>

              <td>

                <div class="inline-actions">

                  ${
                    accountIsOpen(x)

                      ? `
                        <button
                          type="button"
                          class="btn-quiet btn-small"
                          data-settle-account="${esc(x.id)}"
                        >
                          ${
                            x.tipo === 'pagar'
                              ? 'Marcar paga'
                              : 'Marcar recebida'
                          }
                        </button>
                      `

                      : `
                        <button
                          type="button"
                          class="btn-quiet btn-small"
                          data-reopen-account="${esc(x.id)}"
                        >
                          Reabrir
                        </button>
                      `
                  }

                  <button
                    type="button"
                    class="btn-danger btn-small"
                    data-remove="contas"
                    data-index="${i}"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>

                </div>

              </td>

            </tr>
          `;

        }).join('')

    : `
      <tr>
        <td colspan="8" class="empty-row">
          Nenhuma conta registrada.
        </td>
      </tr>
    `;

  const open = a.filter(accountIsOpen);

  const pay = open
    .filter(x => x.tipo === 'pagar')
    .reduce((s, x) => s + n(x.valor), 0);

  const rec = open
    .filter(x => x.tipo === 'receber')
    .reduce((s, x) => s + n(x.valor), 0);

  const late = open
    .filter(x => {
      const d = dateDiff(x.vencimento);

      return d !== null && d < 0;
    }).length;

  $('#contasPagar').textContent = money(pay);

  $('#contasReceber').textContent = money(rec);

  $('#contasVencidas').textContent = late;
}

// ======================================================
// HISTÓRICO
// ======================================================

function renderHistorico() {

  const a = appState.data?.historico || [];

  const filter = $('#filtroHistorico')?.value || '';

  const visible = a.filter(
    x => !filter || String(x.evento || '').includes(filter)
  );

  $('#historicoCount').textContent =
    a.length + ' eventos';

  const counter = $('#resumoHistorico');

  if (counter) {
    counter.textContent = a.length;
  }

  $('#listaHistorico').innerHTML = visible.length

    ? `
      <div class="record-list">

        ${
          visible.map(x => `
            <div class="record-chip" style="display:block">

              <div style="
                display:flex;
                justify-content:space-between;
                gap:12px
              ">

                <strong>
                  ${esc(x.evento || 'Alteração')}
                </strong>

                <span class="tag-muted">
                  ${formatDate(x.data)}
                  ${
                    x.data
                      ? new Date(x.data).toLocaleTimeString(
                          'pt-BR',
                          {
                            hour: '2-digit',
                            minute: '2-digit'
                          }
                        )
                      : ''
                  }
                </span>

              </div>

              <small>
                ${esc(x.origem || 'Painel administrativo')}
              </small>

            </div>
          `).join('')
        }

      </div>
    `

    : `
      <div class="record-empty">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <strong>Nenhum evento registrado</strong>
        <span>As alterações feitas na obra aparecerão aqui após serem agrupadas.</span>
      </div>
    `;
}

// ======================================================
// FINANCIAMENTO
// ======================================================

function calculateCaixa() {

  if (!appState.current || !appState.data) return;

  const total =
    n(appState.data.meta.caixa_valor) ||
    n(appState.current.valor_contrato);

  const pct = Math.min(
    100,
    Math.max(0, n(appState.data.caixa.percentualLiberado))
  );

  $('#caixaJaLiberado').value =
    money(total * pct / 100);

  $('#caixaAReceber').value =
    money(total * (1 - pct / 100));
}

function updateBudgetAlert() {

  if (!appState.data) return;

  const budget = appState.data.financeiro.etapas.reduce(
    (s, x) => s + n(x.orcado),
    0
  );

  const actual = appState.data.financeiro.etapas.reduce(
    (s, x) => s + n(x.realizado),
    0
  );

  const el = $('#alertaEstouro');

  if (budget > 0 && actual > budget) {

    el.style.display = 'block';

    el.textContent =
      `Atenção: o realizado por etapa está ${money(actual - budget)} acima do orçamento cadastrado.`;

  } else {

    el.style.display = 'none';
  }
}

// ======================================================
// INDICADORES GERENCIAIS
// ======================================================

function updateKpis() {

  if (!appState.current || !appState.data) return;

  const d = appState.data;

  const contract = n(appState.current.valor_contrato);

  const budget = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.orcado),
    0
  );

  const actualStages = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.realizado),
    0
  );

  const fees = n(d.financeiro.taxas);

  const actual = actualStages + fees;

  const balance = contract - actual;

  const profit = balance;

  const pct = contract > 0
    ? actual / contract * 100
    : 0;

  const margin = n(d.meta.margem_lucro);

  const deviation = actualStages - budget;

  const physical = weightedProgress();

  const projection = physical > 0
    ? actual / (physical / 100)
    : 0;

  const openAccounts = d.contas
    .filter(accountIsOpen)
    .reduce((s, x) => s + n(x.valor), 0);

  $('#kpiContrato').textContent = money(contract);

  $('#kpiGasto').textContent = money(actual);

  $('#kpiGasto').className =
    actual > contract && contract > 0
      ? 'kpi-negative'
      : '';

  $('#kpiSaldo').textContent = money(balance);

  $('#kpiSaldo').className =
    balance < 0
      ? 'kpi-negative'
      : 'kpi-positive';

  $('#kpiLucro').textContent = money(profit);

  $('#kpiLucro').className =
    profit < 0
      ? 'kpi-negative'
      : 'kpi-positive';

  $('#kpiMargem').textContent =
    `Margem planejada ${margin.toLocaleString('pt-BR')}%`;

  $('#kpiPctGasto').textContent =
    `${pct.toFixed(1)}% do contrato consumido`;

  $('#kpiPctRestante').textContent =
    `${(100 - pct).toFixed(1)}% disponível`;

  $('#progressGasto').style.width =
    `${Math.max(0, Math.min(100, pct))}%`;

  $('#kpiOrcado').textContent = money(budget);

  $('#kpiDesvio').textContent = money(deviation);

  $('#kpiDesvio').className =
    deviation > 0
      ? 'kpi-negative'
      : 'kpi-positive';

  $('#kpiDesvioNota').textContent =
    deviation > 0
      ? 'Realizado acima do orçamento'
      : 'Dentro do orçamento acumulado';

  $('#kpiAvanco').textContent =
    physical.toFixed(1) + '%';

  $('#progressFisico').style.width =
    Math.min(100, physical) + '%';

  $('#kpiProjecao').textContent =
    projection > 0
      ? money(projection)
      : 'Sem base';

  $('#kpiContasAbertas').textContent =
    money(openAccounts);

  $('#kpiContasNota').textContent =
    `${d.contas.filter(accountIsOpen).length} compromisso(s) em aberto`;

  $('#resumoContrato').textContent = money(contract);

  $('#resumoOrcado').textContent = money(budget);

  $('#resumoGasto').textContent = money(actualStages);

  $('#resumoTaxas').textContent = money(fees);

  $('#resumoSaldo').textContent = money(balance);

  $('#resumoLucro').textContent = money(profit);

  $('#resumoMargem').textContent = contract
    ? `${(profit / contract * 100).toFixed(1)}%`
    : '0%';

  renderDashboardAlerts();
}

function renderDashboardAlerts() {

  const list = $('#dashboardAlertsList');

  const count = $('#dashboardAlertCount');

  if (!appState.data || !appState.current) {

    count.textContent = '0 alertas';

    list.innerHTML = `
      <div class="dashboard-alert-item">
        <i class="fa-solid fa-circle-info"></i>
        <span>Selecione uma obra para visualizar os alertas.</span>
      </div>
    `;

    return;
  }

  const d = appState.data;

  const alerts = [];

  const contract = n(appState.current.valor_contrato);

  const budget = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.orcado),
    0
  );

  const stageActual = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.realizado),
    0
  );

  const actual = stageActual + n(d.financeiro.taxas);

  if (contract > 0 && actual > contract) {

    alerts.push({
      type: 'danger',
      icon: 'fa-triangle-exclamation',
      text: `O custo registrado ultrapassou o contrato em ${money(actual - contract)}.`
    });
  }

  if (budget > 0 && stageActual > budget) {

    alerts.push({
      type: 'warning',
      icon: 'fa-chart-line',
      text: `O realizado por etapa está ${money(stageActual - budget)} acima do orçamento planejado.`
    });
  }

  const lowSup = d.fornecedores.filter(
    x => supplierScore(x).className === 'low'
  ).length;

  if (lowSup) {

    alerts.push({
      type: 'warning',
      icon: 'fa-truck-field',
      text: `${lowSup} fornecedor(es) precisam de atenção por nota baixa ou atraso.`
    });
  }

  const lowStock = d.estoque.filter(x => {

    const bal = n(x.comprado) - n(x.utilizado);

    return (
      bal < 0 ||
      (
        n(x.comprado) > 0 &&
        bal <= n(x.comprado) * .2
      )
    );

  }).length;

  if (lowStock) {

    alerts.push({
      type: 'warning',
      icon: 'fa-boxes-stacked',
      text: `${lowStock} material(is) com estoque crítico ou necessidade de reposição.`
    });
  }

  const lateTasks = d.cronogramaFisico.filter(
    x => scheduleStatus(x).label === 'Atrasada'
  ).length;

  if (lateTasks) {

    alerts.push({
      type: 'danger',
      icon: 'fa-calendar-xmark',
      text: `${lateTasks} etapa(s) do cronograma estão com prazo vencido e avanço inferior a 100%.`
    });
  }

  const lateAccounts = d.contas.filter(x =>
    accountIsOpen(x) &&
    dateDiff(x.vencimento) !== null &&
    dateDiff(x.vencimento) < 0
  ).length;

  if (lateAccounts) {

    alerts.push({
      type: 'danger',
      icon: 'fa-file-invoice-dollar',
      text: `${lateAccounts} conta(s) em aberto estão vencidas.`
    });
  }

  const next = d.caixa.proximaMedicao;

  if (hasCaixaFinancing() && next) {

    const days = dateDiff(next);

    if (days < 0) {

      alerts.push({
        type: 'danger',
        icon: 'fa-calendar-xmark',
        text: `A próxima medição estava prevista para ${formatDate(next)} e está vencida.`
      });

    } else if (days <= 7) {

      alerts.push({
        type: 'warning',
        icon: 'fa-calendar-check',
        text: `Próxima medição prevista para ${formatDate(next)}${days === 0 ? ' (hoje)' : ` (em ${days} dia(s))`}.`
      });
    }
  }

  count.textContent =
    `${alerts.length} ${alerts.length === 1 ? 'alerta' : 'alertas'}`;

  list.innerHTML = alerts.length

    ? alerts.map(x => `
        <div class="dashboard-alert-item ${x.type}">
          <i class="fa-solid ${x.icon}"></i>
          <span>${esc(x.text)}</span>
        </div>
      `).join('')

    : `
      <div class="dashboard-alert-item success">
        <i class="fa-solid fa-circle-check"></i>
        <span>
          Nenhum alerta identificado nos dados cadastrados.
          Continue atualizando os lançamentos.
        </span>
      </div>
    `;
}

// ======================================================
// ADICIONAR REGISTROS
// ======================================================

function addFornecedor() {

  addItem('fornecedores', {
    id: makeId(),
    empresa: '',
    cnpj: '',
    servico: '',
    valor: 0,
    atraso: 0,
    nota: ''
  });
}

function addStock() {

  addItem('estoque', {
    id: makeId(),
    material: '',
    unidade: 'un',
    comprado: 0,
    utilizado: 0
  });
}

function addStage() {

  addItem('financeiro.etapas', {
    id: makeId(),
    nome: 'Nova etapa',
    orcado: 0,
    realizado: 0
  });
}

function addCashflow(ev) {

  ev.preventDefault();

  if (!appState.current) {
    return toast('Selecione uma obra primeiro.', 'error');
  }

  const v = n($('#fluxoValor').value);

  const date = $('#fluxoData').value;

  const desc = $('#fluxoDescricao').value.trim();

  if (v <= 0 || !date || !desc) {
    return toast('Preencha data, valor e descrição.', 'error');
  }

  addItem('fluxo', {
    id: makeId(),
    tipo: $('#fluxoTipo').value,
    data: date,
    valor: v,
    descricao: desc
  });

  $('#fluxoForm').reset();

  $('#fluxoData').value = todayISO();
}

function addCronograma(ev) {

  ev.preventDefault();

  const nome = $('#crNome').value.trim();

  const peso = n($('#crPeso').value);

  const avanco = n($('#crAvanco').value);

  if (!nome) {
    return toast('Informe o nome da etapa.', 'error');
  }

  if (
    peso < 0 ||
    peso > 100 ||
    avanco < 0 ||
    avanco > 100
  ) {
    return toast(
      'Peso e avanço devem ficar entre 0 e 100%.',
      'error'
    );
  }

  addItem('cronogramaFisico', {

    id: makeId(),

    nome,

    inicio: $('#crInicio').value,

    fim: $('#crFim').value,

    peso,

    avanco,

    responsavel: $('#crResponsavel').value.trim()
  });

  $('#cronogramaForm').reset();

  $('#crPeso').value = 10;

  $('#crAvanco').value = 0;
}

function addDiario(ev) {

  ev.preventDefault();

  const atividades = $('#diAtividades').value.trim();

  if (!atividades) {
    return toast('Descreva as atividades executadas.', 'error');
  }

  addItem('diario', {

    id: makeId(),

    data: $('#diData').value || todayISO(),

    clima: $('#diClima').value,

    equipe: $('#diEquipe').value.trim(),

    responsavel: $('#diResponsavel').value.trim(),

    atividades,

    ocorrencias: $('#diOcorrencias').value.trim(),

    proximos: $('#diProximos').value.trim(),

    fotoUrl: $('#diFotoUrl').value.trim(),

    created_at: new Date().toISOString()
  });

  $('#diarioForm').reset();

  $('#diData').value = todayISO();
}

function addCompra(ev) {

  ev.preventDefault();

  const material = $('#coMaterial').value.trim();

  const q = n($('#coQuantidade').value);

  if (!material || q <= 0) {
    return toast('Informe material e quantidade válida.', 'error');
  }

  addItem('compras', {

    id: makeId(),

    material,

    categoria: $('#coCategoria').value,

    unidade: $('#coUnidade').value,

    quantidade: q,

    preco: n($('#coPreco').value),

    fornecedor: $('#coFornecedor').value.trim(),

    data: $('#coData').value,

    status: $('#coStatus').value,

    observacao: $('#coObservacao').value.trim(),

    origem: 'manual'
  });

  $('#compraForm').reset();

  $('#coPreco').value = 0;
}

function addConta(ev) {

  ev.preventDefault();

  const desc = $('#ctDescricao').value.trim();

  const v = n($('#ctValor').value);

  const date = $('#ctVencimento').value;

  if (!desc || v <= 0 || !date) {
    return toast(
      'Preencha descrição, vencimento e valor válido.',
      'error'
    );
  }

  addItem('contas', {

    id: makeId(),

    tipo: $('#ctTipo').value,

    descricao: desc,

    favorecido: $('#ctFavorecido').value.trim(),

    categoria: $('#ctCategoria').value,

    vencimento: date,

    valor: v,

    status: 'aberta',

    fluxoId: null,

    created_at: new Date().toISOString()
  });

  $('#contaForm').reset();

  $('#ctVencimento').value = todayISO();
}

// ======================================================
// BAIXA E REABERTURA DE CONTAS
// ======================================================

function settleAccount(id) {

  const x = appState.data.contas.find(
    a => String(a.id) === String(id)
  );

  if (!x || !accountIsOpen(x)) return;

  const type = x.tipo === 'pagar'
    ? 'saida'
    : 'entrada';

  const date = todayISO();

  const label =
    `${x.tipo === 'pagar' ? 'Pagamento' : 'Recebimento'} — ${x.descricao}`;

  const flow = {

    id: makeId(),

    tipo: type,

    data: date,

    valor: n(x.valor),

    descricao: label,

    accountId: x.id
  };

  appState.data.fluxo.push(flow);

  x.fluxoId = flow.id;

  x.status =
    x.tipo === 'pagar'
      ? 'paga'
      : 'recebida';

  x.dataBaixa = date;

  renderAll();

  markDirty('Baixa de conta registrada no fluxo');

  toast(
    'Conta baixada e movimentação lançada no fluxo de caixa.',
    'success'
  );
}

function reopenAccount(id) {

  const x = appState.data.contas.find(
    a => String(a.id) === String(id)
  );

  if (!x || accountIsOpen(x)) return;

  if (!confirm(
    'Reabrir esta conta e remover a movimentação que foi criada automaticamente no fluxo de caixa?'
  )) {
    return;
  }

  if (x.fluxoId) {

    appState.data.fluxo =
      appState.data.fluxo.filter(
        f => String(f.id) !== String(x.fluxoId)
      );
  }

  x.fluxoId = null;

  x.status = 'aberta';

  x.dataBaixa = null;

  renderAll();

  markDirty('Conta reaberta');
}

// ======================================================
// EDIÇÃO DE CAMPOS
// ======================================================

function onFieldEdit(ev) {

  const el = ev.target;

  if (!appState.data) return;

  const settled =
    ev.type === 'change' ||
    el.matches('select,[type="checkbox"]');

  if (el.dataset.collection) {

    const a = collection(el.dataset.collection);

    const item = Array.isArray(a)
      ? a[Number(el.dataset.index)]
      : null;

    if (!item) return;

    const v = el.type === 'number'
      ? n(el.value)
      : el.value;

    item[el.dataset.key] = v;

    if (settled) {

      if (el.dataset.collection === 'caixa.cronograma') {
        renderCaixa();

      } else if (el.dataset.collection === 'cronogramaFisico') {
        renderCronograma();

      } else if (el.dataset.collection === 'compras') {
        renderCompras();

      } else if (el.dataset.collection === 'contas') {
        renderContas();

      } else if (el.dataset.collection === 'diario') {
        renderDiario();

      } else if (el.dataset.collection === 'fornecedores') {
        renderFornecedores();

      } else if (el.dataset.collection === 'estoque') {
        renderEstoque();

      } else if (el.dataset.collection === 'financeiro.etapas') {
        renderComparativo();
      }
    }

    markDirty();

    return;
  }

  if (el.dataset.scope) {

    const obj = collection(el.dataset.scope);

    if (!obj) return;

    obj[el.dataset.key] =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? n(el.value)
          : el.value;

    if (el.dataset.scope === 'caixa') {
      calculateCaixa();
    }

    markDirty();
  }
}

// ======================================================
// CALCULADORAS
// ======================================================

// Um único motor atualiza todos os resultados.

function val(id) {

  return Math.max(
    0,
    n($('#' + id)?.value)
  );
}

function put(id, text) {

  const e = $('#' + id);

  if (e) {
    e.textContent = text;
  }
}

function updateCalcItem(
  name,
  quantity,
  unit,
  category = 'Materiais básicos',
  unitPrice = 0
) {

  quantity = Math.max(0, n(quantity));

  if (quantity > 0) {

    const old = appState.calcItems.find(
      x => x.material === name && x.unidade === unit
    );

    if (old) {

      old.quantidade = quantity;

      old.categoria = category;

      old.preco = n(unitPrice);

    } else {

      appState.calcItems.push({

        material: name,

        quantidade,

        unidade: unit,

        categoria: category,

        preco: n(unitPrice)
      });
    }
  }
}

function calcAll() {

  const items = [];

  const add = (
    material,
    q,
    unit,
    cat = 'Materiais básicos',
    price = 0
  ) => {

    if (Number.isFinite(q) && q > 0) {

      items.push({

        material,

        quantidade: q,

        unidade: unit,

        categoria: cat,

        preco: n(price)
      });
    }
  };

  // ----------------------------------------------------
  // CONCRETO
  // ----------------------------------------------------

  const cv = val('cVol');

  const cl = 1 + val('cPerda') / 100;

  const ct = $('#cTraco').value;

  const coef = ct === '1152'

    ? { c: 9, s: .48, b: .64 }

    : ct === '134'
      ? { c: 5.5, s: .66, b: .88 }
      : { c: 7, s: .56, b: .84 };

  const cc = Math.ceil(cv * coef.c * cl);

  const cs = cv * coef.s * cl;

  const cb = cv * coef.b * cl;

  const costC =
    cc * val('cPrecoCimento') +
    cs * val('cPrecoAreia') +
    cb * val('cPrecoBrita');

  put(
    'cOutCimento',
    `Cimento: ${cc.toLocaleString('pt-BR')} sacos de 50 kg`
  );

  put(
    'cOutAreia',
    `Areia: ${cs.toFixed(2)} m³`
  );

  put(
    'cOutBrita',
    `Brita: ${cb.toFixed(2)} m³`
  );

  put(
    'cOutCusto',
    `Custo estimado: ${money(costC)}`
  );

  add(
    'Cimento — concreto',
    cc,
    'saco',
    'Materiais básicos',
    val('cPrecoCimento')
  );

  add(
    'Areia — concreto',
    cs,
    'm³',
    'Materiais básicos',
    val('cPrecoAreia')
  );

  add(
    'Brita — concreto',
    cb,
    'm³',
    'Materiais básicos',
    val('cPrecoBrita')
  );

  // ----------------------------------------------------
  // TERRA / ATERRO / CASCALHO
  // ----------------------------------------------------

  const compact =
    val('tComp') *
    val('tLarg') *
    val('tAlt');

  const loose =
    compact *
    (1 + val('tEmp') / 100) *
    (1 + val('tPerda') / 100);

  const costT = loose * val('tPreco');

  put(
    'tOutCompactado',
    `Volume compactado: ${compact.toFixed(2)} m³`
  );

  put(
    'tOutSolto',
    `Volume solto estimado: ${loose.toFixed(2)} m³`
  );

  put(
    'tOutCusto',
    `Custo estimado: ${money(costT)}`
  );

  add(
    'Terra / aterro / cascalho',
    loose,
    'm³',
    'Materiais básicos',
    val('tPreco')
  );

  // ----------------------------------------------------
  // LASTRO E CONTRAPISO
  // ----------------------------------------------------

  const lGeom =
    val('lArea') *
    (val('lEsp') / 100);

  const lTipo = $('#lTipo').value;

  const lRatio =
    lTipo === 'contrapiso'
      ? { c: 1, s: 4 }
      : lTipo === 'lastro'
        ? { c: 1, s: 5 }
        : null;

  const lDry =
    lGeom *
    (lTipo === 'areia' ? 1.15 : 1.33);

  const lSand = lRatio
    ? lDry * lRatio.s / (lRatio.c + lRatio.s)
    : lDry;

  const lCement = lRatio
    ? Math.ceil(
        (lDry * lRatio.c / (lRatio.c + lRatio.s)) / .035
      )
    : 0;

  const lCost =
    lSand * val('lPrecoAreia') +
    lCement * val('lPrecoCimento');

  put(
    'lOutVolume',
    `Volume geométrico: ${lGeom.toFixed(2)} m³ · volume estimado: ${lDry.toFixed(2)} m³`
  );

  put(
    'lOutAreia',
    `Areia: ${lSand.toFixed(2)} m³`
  );

  put(
    'lOutCimento',
    `Cimento: ${lCement} sacos de 50 kg`
  );

  put(
    'lOutCusto',
    `Custo estimado: ${money(lCost)}`
  );

  add(
    'Areia — lastro/contrapiso',
    lSand,
    'm³',
    'Materiais básicos',
    val('lPrecoAreia')
  );

  if (lCement) {

    add(
      'Cimento — lastro/contrapiso',
      lCement,
      'saco',
      'Materiais básicos',
      val('lPrecoCimento')
    );
  }

  // ----------------------------------------------------
  // ALVENARIA
  // ----------------------------------------------------

  const aq = Math.ceil(
    val('aArea') *
    val('aTipo') *
    (1 + val('aPerda') / 100)
  );

  const aCost = aq / 1000 * val('aPreco');

  const mortarVol =
    val('aArea') * .015 * 1.1;

  put(
    'aOutQtd',
    `Blocos / tijolos: ${aq.toLocaleString('pt-BR')} unidades`
  );

  put(
    'aOutArgamassa',
    `Argamassa de assentamento: aprox. ${mortarVol.toFixed(2)} m³`
  );

  put(
    'aOutCusto',
    `Custo estimado dos blocos: ${money(aCost)}`
  );

  add(
    'Blocos / tijolos de alvenaria',
    aq,
    'un',
    'Alvenaria',
    val('aPreco') / 1000
  );

  add(
    'Argamassa de assentamento (estimativa)',
    mortarVol,
    'm³',
    'Alvenaria'
  );

  // ----------------------------------------------------
  // PISO / ARGAMASSA / REJUNTE
  // ----------------------------------------------------

  const pArea =
    val('pArea') *
    (1 + val('pPerda') / 100);

  const pArgKg =
    pArea * val('pConsumoArg');

  const pSacos = Math.ceil(
    pArgKg / Math.max(1, val('pSacoArg'))
  );

  const pRej =
    pArea * val('pConsumoRej');

  const pCost =
    pArea * val('pPreco');

  put(
    'pOutArea',
    `Piso com perda: ${pArea.toFixed(2)} m²`
  );

  put(
    'pOutArg',
    `Argamassa colante: ${pSacos} sacos (${pArgKg.toFixed(1)} kg)`
  );

  put(
    'pOutRej',
    `Rejunte: ${pRej.toFixed(1)} kg`
  );

  put(
    'pOutCusto',
    `Custo do piso: ${money(pCost)}`
  );

  add(
    'Piso / porcelanato',
    pArea,
    'm²',
    'Acabamento',
    val('pPreco')
  );

  add(
    'Argamassa colante',
    pSacos,
    'saco',
    'Acabamento'
  );

  add(
    'Rejunte',
    pRej,
    'kg',
    'Acabamento'
  );

  // ----------------------------------------------------
  // REBOCO / CHAPISCO / ARGAMASSA
  // ----------------------------------------------------

  const mVol =
    val('mArea') *
    (val('mEsp') / 100) *
    (1 + val('mPerda') / 100) *
    1.33;

  const mt = $('#mTipo').value;

  const rat = mt === 'chapisco'

    ? { c: 1, s: 3, l: 0 }

    : mt === 'assenta'
      ? { c: 1, l: 1, s: 6 }
      : { c: 1, l: 2, s: 8 };

  const sum = rat.c + rat.l + rat.s;

  const cVol = mVol * rat.c / sum;

  const sVol = mVol * rat.s / sum;

  const lVol = mVol * rat.l / sum;

  const cSacks = Math.ceil(cVol / .035);

  const lSacks = Math.ceil(lVol / .035);

  put(
    'mOutVolume',
    `Volume seco estimado: ${mVol.toFixed(2)} m³`
  );

  put(
    'mOutCimento',
    `Cimento: ${cSacks} sacos`
  );

  put(
    'mOutCal',
    `Cal: ${lSacks} sacos`
  );

  put(
    'mOutAreia',
    `Areia: ${sVol.toFixed(2)} m³`
  );

  add(
    'Cimento — argamassa',
    cSacks,
    'saco',
    'Alvenaria'
  );

  if (lSacks) {
    add(
      'Cal hidratada',
      lSacks,
      'saco',
      'Alvenaria'
    );
  }

  add(
    'Areia — argamassa',
    sVol,
    'm³',
    'Alvenaria'
  );

  // ----------------------------------------------------
  // AÇO
  // ----------------------------------------------------

  const dia = val('sBitola');

  const bars = val('sBarras');

  const len = val('sComprimento');

  const steelKg =
    bars *
    len *
    (dia * dia / 162) *
    (1 + val('sPerda') / 100);

  const barsLoss = Math.ceil(
    bars * (1 + val('sPerda') / 100)
  );

  const wire =
    steelKg * val('sAramePct') / 100;

  const steelCost =
    steelKg * val('sPreco');

  put(
    'sOutPeso',
    `Peso de aço: ${steelKg.toFixed(1)} kg (${(steelKg / 1000).toFixed(3)} t)`
  );

  put(
    'sOutBarras',
    `Barras de ${dia} mm com perda: ${barsLoss} un`
  );

  put(
    'sOutArame',
    `Arame recozido estimado: ${wire.toFixed(1)} kg`
  );

  put(
    'sOutCusto',
    `Custo do aço: ${money(steelCost)}`
  );

  add(
    `Aço CA-50/CA-60 ${dia} mm`,
    steelKg,
    'kg',
    'Estrutura',
    val('sPreco')
  );

  add(
    'Arame recozido',
    wire,
    'kg',
    'Estrutura'
  );

  // ----------------------------------------------------
  // PINTURA
  // ----------------------------------------------------

  const ptArea = val('ptArea');

  const liters =
    ptArea *
    val('ptDemaos') /
    Math.max(.1, val('ptRend')) *
    (1 + val('ptPerda') / 100);

  const sel =
    ptArea /
    Math.max(.1, val('ptRend')) *
    (1 + val('ptPerda') / 100);

  const massa =
    ptArea *
    val('ptMassaCons') *
    (1 + val('ptPerda') / 100);

  const paintCost =
    liters * val('ptPreco');

  put(
    'ptOutTinta',
    `Tinta: ${liters.toFixed(1)} L`
  );

  put(
    'ptOutSelador',
    `Selador: ${sel.toFixed(1)} L (1 demão, referência)`
  );

  put(
    'ptOutMassa',
    `Massa: ${massa.toFixed(1)} kg`
  );

  put(
    'ptOutCusto',
    `Custo da tinta: ${money(paintCost)}`
  );

  add(
    'Tinta',
    liters,
    'L',
    'Acabamento',
    val('ptPreco')
  );

  add(
    'Selador / fundo preparador',
    sel,
    'L',
    'Acabamento'
  );

  add(
    'Massa corrida / acrílica',
    massa,
    'kg',
    'Acabamento'
  );

  // ----------------------------------------------------
  // TELHADO
  // ----------------------------------------------------

  const roofArea = val('rArea');

  const roofFactor = val('rTipo');

  const roofQty = Math.ceil(
    (
      roofFactor > 5
        ? roofArea * roofFactor
        : roofArea / roofFactor
    ) *
    (1 + val('rPerda') / 100)
  );

  const roofCost =
    roofQty * val('rPreco');

  put(
    'rOutQtd',
    `Telhas / chapas: ${roofQty.toLocaleString('pt-BR')} unidades`
  );

  put(
    'rOutMadeira',
    'Estrutura, cumeeira, rufos e fixadores: calcular conforme projeto'
  );

  put(
    'rOutCusto',
    `Custo telhas: ${money(roofCost)}`
  );

  add(
    'Telhas / chapas de cobertura',
    roofQty,
    'un',
    'Estrutura',
    val('rPreco')
  );

  // ----------------------------------------------------
  // ELÉTRICA
  // ----------------------------------------------------

  const baseCable =
    val('ePontos') * val('eMetros');

  const cables =
    baseCable *
    val('eCabos') *
    (1 + val('ePerda') / 100);

  const conduit =
    baseCable *
    (1 + val('ePerda') / 100);

  const electricCost =
    cables * val('ePrecoCabo') +
    conduit * val('ePrecoCond');

  put(
    'eOutCabo',
    `Cabos somados: ${cables.toFixed(1)} m`
  );

  put(
    'eOutCond',
    `Conduíte: ${conduit.toFixed(1)} m`
  );

  put(
    'eOutCusto',
    `Custo estimado: ${money(electricCost)}`
  );

  add(
    'Cabos elétricos — metragem somada',
    cables,
    'm',
    'Elétrica',
    val('ePrecoCabo')
  );

  add(
    'Conduíte corrugado',
    conduit,
    'm',
    'Elétrica',
    val('ePrecoCond')
  );

  // ----------------------------------------------------
  // HIDRÁULICA
  // ----------------------------------------------------

  const hp = 1 + val('hPerda') / 100;

  const water = val('hAgua') * hp;

  const sewer = val('hEsgoto') * hp;

  const hydCost =
    water * val('hPrecoAgua') +
    sewer * val('hPrecoEsgoto');

  put(
    'hOutAgua',
    `Tubos água fria: ${water.toFixed(1)} m`
  );

  put(
    'hOutEsgoto',
    `Tubos esgoto: ${sewer.toFixed(1)} m`
  );

  put(
    'hOutCusto',
    `Custo estimado dos tubos: ${money(hydCost)}`
  );

  add(
    'Tubulação PVC água fria',
    water,
    'm',
    'Hidráulica',
    val('hPrecoAgua')
  );

  add(
    'Tubulação PVC esgoto',
    sewer,
    'm',
    'Hidráulica',
    val('hPrecoEsgoto')
  );

  // ----------------------------------------------------
  // IMPERMEABILIZAÇÃO
  // ----------------------------------------------------

  const imp =
    val('iArea') *
    val('iConsumo') *
    val('iDemaos') *
    (1 + val('iPerda') / 100);

  const impCost =
    imp * val('iPreco');

  put(
    'iOutQtd',
    `Produto impermeabilizante: ${imp.toFixed(1)} kg/L`
  );

  put(
    'iOutCusto',
    `Custo estimado: ${money(impCost)}`
  );

  add(
    'Impermeabilizante',
    imp,
    'kg/L',
    'Impermeabilização',
    val('iPreco')
  );

  // ----------------------------------------------------
  // RESUMO GERAL
  // ----------------------------------------------------

  appState.calcItems = items;

  const knownSubtotal = items.reduce(
    (sum, x) => sum + n(x.quantidade) * n(x.preco),
    0
  );

  put(
    'calcCustoTotal',
    `Subtotal dos itens com preço informado: ${money(knownSubtotal)}`
  );

  const grouped = new Map();

  items.forEach(x => {

    const k = x.material + '|' + x.unidade;

    const old = grouped.get(k) || {
      ...x,
      quantidade: 0
    };

    old.quantidade += x.quantidade;

    grouped.set(k, old);
  });

  const out = [...grouped.values()];

  $('#calcResumoMateriais').innerHTML = out.length

    ? out.map(x => `
        <div class="calc-total-row">
          <span>${esc(x.material)}</span>
          <strong>
            ${x.quantidade.toLocaleString('pt-BR', {
              maximumFractionDigits: 2
            })}
            ${esc(x.unidade)}
          </strong>
        </div>
      `).join('')

    : `
      <span>
        Informe as medidas nas calculadoras para montar o resumo.
      </span>
    `;

  const sumBy = test =>
    items.filter(test).reduce(
      (total, x) => total + n(x.quantidade),
      0
    );

  const totalCimento = sumBy(
    x => /cimento/i.test(x.material) && x.unidade === 'saco'
  );

  const totalAreia = sumBy(
    x => /areia/i.test(x.material) && x.unidade === 'm³'
  );

  const totalBrita = sumBy(
    x => /brita/i.test(x.material) && x.unidade === 'm³'
  );

  const totalTerra = sumBy(
    x => /terra/i.test(x.material) && x.unidade === 'm³'
  );

  $('#calcResumoTotais').innerHTML = `
    <span>
      Cimento total:
      <strong>${Math.ceil(totalCimento)} sacos</strong>
    </span>

    <span>
      Areia total:
      <strong>${totalAreia.toFixed(2)} m³</strong>
    </span>

    <span>
      Brita total:
      <strong>${totalBrita.toFixed(2)} m³</strong>
    </span>

    <span>
      Terra total:
      <strong>${totalTerra.toFixed(2)} m³</strong>
    </span>
  `;
}

// ======================================================
// ENVIAR ESTIMATIVAS PARA COMPRAS
// ======================================================

function sendCalcToPurchases() {

  if (!appState.current) {
    return toast(
      'Selecione uma obra antes de enviar os quantitativos.',
      'error'
    );
  }

  calcAll();

  if (!appState.calcItems.length) {
    return toast(
      'Não há quantitativos calculados para enviar.',
      'error'
    );
  }

  const grouped = new Map();

  appState.calcItems.forEach(x => {

    const k = x.material + '|' + x.unidade;

    const old = grouped.get(k) || {
      ...x,
      quantidade: 0
    };

    old.quantidade += x.quantidade;

    grouped.set(k, old);
  });

  [...grouped.values()].forEach(x => {

    appState.data.compras.push({

      id: makeId(),

      material: x.material,

      categoria: x.categoria,

      unidade: x.unidade,

      quantidade: Number(x.quantidade.toFixed(3)),

      preco: n(x.preco),

      fornecedor: '',

      data: '',

      status: 'Planejada',

      observacao: 'Estimativa gerada pelas calculadoras. Conferir projeto e cotação.',

      origem: 'calculadora'
    });
  });

  renderCompras();

  markDirty('Quantitativos enviados para compras');

  navigateToView('compras');

  toast(
    `${grouped.size} item(ns) enviado(s) para Compras e Cotações.`,
    'success'
  );
}

// ======================================================
// COMPARATIVO ENTRE OBRAS
// ======================================================

async function renderWorkComparison() {

  const body = $('#tbodyComparativoObras');

  if (!body) return;

  if (!appState.records.length) {

    body.innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">
          Nenhuma obra cadastrada.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = `
    <tr>
      <td colspan="8" class="empty-row">
        Carregando dados das obras...
      </td>
    </tr>
  `;

  const results = await Promise.allSettled(

    appState.records.map(async row => {

      let r;

      if (
        appState.current &&
        String(appState.current.id) === String(row.id)
      ) {

        r = appState.current;

      } else if (row.dados) {

        r = row;

      } else {

        r = await api(
          '/api/erp/obras/' + encodeURIComponent(row.id)
        );
      }

      const d = mergeData(r.dados || {}, {});

      const contract = n(r.valor_contrato);

      const cost =
        d.financeiro.etapas.reduce(
          (sum, x) => sum + n(x.realizado),
          0
        ) +
        n(d.financeiro.taxas);

      let progress = 0;

      const tasks = d.cronogramaFisico;

      if (tasks.length) {

        const weight = tasks.reduce(
          (sum, x) => sum + n(x.peso),
          0
        );

        progress = weight

          ? tasks.reduce(
              (sum, x) => sum + n(x.peso) * n(x.avanco) / 100,
              0
            ) / weight * 100

          : tasks.reduce(
              (sum, x) => sum + n(x.avanco),
              0
            ) / tasks.length;
      }

      return {
        r,
        contract,
        cost,
        progress
      };
    })
  );

  body.innerHTML = results.map((result, i) => {

    if (result.status !== 'fulfilled') {

      const row = appState.records[i];

      return `
        <tr>

          <td>${esc(row.id_obra || 'Obra')}</td>

          <td>${esc(row.cliente_nome || '')}</td>

          <td>${esc(row.status || '')}</td>

          <td colspan="4">
            Não foi possível carregar os indicadores.
          </td>

          <td>—</td>

        </tr>
      `;
    }

    const {
      r,
      contract,
      cost,
      progress
    } = result.value;

    return `
      <tr>

        <td>
          ${esc(r.id_obra || '—')}
        </td>

        <td>
          ${esc(r.cliente_nome || '—')}
        </td>

        <td>
          ${esc(r.status || '—')}
        </td>

        <td>
          ${money(contract)}
        </td>

        <td>
          ${money(cost)}
        </td>

        <td style="
          color:${contract - cost < 0 ? '#b66e67' : '#718a69'}
        ">
          ${money(contract - cost)}
        </td>

        <td>
          ${progress.toFixed(1)}%
        </td>

        <td>
          <button
            type="button"
            class="btn-quiet btn-small"
            data-open-work="${esc(r.id)}"
          >
            Abrir
          </button>
        </td>

      </tr>
    `;
  }).join('');
}

// ======================================================
// DOCUMENTOS PDF
// ======================================================

function pdfAvailable() {

  if (!window.jspdf?.jsPDF) {

    toast(
      'Biblioteca de PDF indisponível. Verifique a conexão e recarregue a página.',
      'error'
    );

    return false;
  }

  return true;
}

function pdfBase(title, subtitle) {

  const doc = new window.jspdf.jsPDF({
    unit: 'mm',
    format: 'a4'
  });

  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(23, 26, 29);

  doc.rect(0, 0, w, 31, 'F');

  doc.setFillColor(184, 148, 94);

  doc.rect(0, 31, w, 1.2, 'F');

  doc.setTextColor(255, 255, 255);

  doc.setFont('helvetica', 'bold');

  doc.setFontSize(15);

  doc.text('PH ENGENHARIA', 15, 13);

  doc.setFont('helvetica', 'normal');

  doc.setFontSize(8);

  doc.setTextColor(220, 211, 195);

  doc.text(
    'GESTÃO INTEGRADA DE OBRAS',
    15,
    20
  );

  doc.setFont('helvetica', 'bold');

  doc.setFontSize(12);

  doc.setTextColor(255, 255, 255);

  doc.text(title, w - 15, 13, {
    align: 'right'
  });

  doc.setFont('helvetica', 'normal');

  doc.setFontSize(8);

  doc.text(subtitle || '', w - 15, 20, {
    align: 'right'
  });

  doc.setTextColor(45, 45, 43);

  doc.setFont('helvetica', 'bold');

  doc.setFontSize(13);

  doc.text(recordMeta().id_obra || 'Obra', 15, 43);

  doc.setFont('helvetica', 'normal');

  doc.setFontSize(9);

  doc.setTextColor(105, 103, 96);

  doc.text(
    `Cliente: ${recordMeta().cliente_nome || ''}`,
    15,
    50
  );

  doc.text(
    `Endereço: ${recordMeta().endereco || 'Não informado'}`,
    15,
    56
  );

  doc.text(
    `Emitido em: ${new Date().toLocaleString('pt-BR')}`,
    15,
    62
  );

  return doc;
}

function pdfLine(doc, label, value, y, bold = false) {

  doc.setFont(
    'helvetica',
    bold ? 'bold' : 'normal'
  );

  doc.setFontSize(9);

  doc.setTextColor(75, 74, 70);

  doc.text(String(label), 15, y);

  doc.setTextColor(55, 55, 52);

  doc.text(String(value), 195, y, {
    align: 'right'
  });
}

function pdfFooter(doc) {

  for (
    let i = 1;
    i <= doc.internal.getNumberOfPages();
    i++
  ) {

    doc.setPage(i);

    const h = doc.internal.pageSize.getHeight();

    doc.setDrawColor(224, 218, 207);

    doc.line(15, h - 15, 195, h - 15);

    doc.setFont('helvetica', 'normal');

    doc.setFontSize(7);

    doc.setTextColor(135, 130, 119);

    doc.text(
      'PH ENGENHARIA · Documento gerado pelo Minha Obra',
      15,
      h - 9
    );

    doc.text(
      `${i}/${doc.internal.getNumberOfPages()}`,
      195,
      h - 9,
      {
        align: 'right'
      }
    );
  }
}

function fileSafe(v) {

  return String(v || 'obra')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function addDocument(collection, item, kind) {

  item.id = makeId();

  item.created_at = new Date().toISOString();

  appState.data[collection].push(item);

  renderDocuments();

  markDirty('Documento registrado');

  generateDocumentPdf(kind, item);
}

function generateDocumentPdf(kind, item) {

  if (!pdfAvailable()) return;

  const doc = pdfBase(kind, 'DOCUMENTO DE OBRA');

  let y = 78;

  doc.setFont('helvetica', 'bold');

  doc.setFontSize(12);

  doc.setTextColor(145, 116, 72);

  doc.text(kind.toUpperCase(), 15, y);

  y += 12;

  const details = kind === 'Contrato'

    ? [
        ['Contratado', item.nome],
        ['Documento', item.documento || 'Não informado'],
        ['Objeto', item.titulo],
        ['Valor', money(item.valor)],
        ['Prazo / condição', item.prazo || 'A definir']
      ]

    : kind === 'Recibo'

      ? [
          ['Recebedor', item.nome],
          ['Documento', item.documento || 'Não informado'],
          ['Valor recebido', money(item.valor)],
          ['Referente a', item.descricao],
          ['Data', formatDate(item.data)]
        ]

      : [
          ['Serviço extra', item.descricao],
          ['Valor proposto', money(item.valor)],
          ['Situação', item.status],
          ['Data', formatDate(item.data)]
        ];

  details.forEach(([a, b]) => {

    doc.setFont('helvetica', 'bold');

    doc.setFontSize(9);

    doc.setTextColor(120, 115, 105);

    doc.text(a, 15, y);

    doc.setFont('helvetica', 'normal');

    doc.setTextColor(45, 45, 43);

    doc.text(
      doc.splitTextToSize(String(b || '—'), 120),
      70,
      y
    );

    y += 10;
  });

  y += 12;

  if (kind === 'Contrato') {

    const p =
      'As partes identificadas neste documento declaram que os serviços descritos serão executados conforme escopo, prazo, condições e valores registrados, observando os projetos, especificações técnicas, normas aplicáveis e demais condições formalmente acordadas.';

    doc.setFont('helvetica', 'normal');

    doc.setFontSize(9);

    doc.setTextColor(65, 64, 60);

    doc.text(
      doc.splitTextToSize(p, 180),
      15,
      y
    );
  }

  doc.setDrawColor(190, 174, 146);

  doc.line(20, 245, 90, 245);

  doc.line(120, 245, 190, 245);

  doc.setFont('helvetica', 'normal');

  doc.setFontSize(8);

  doc.setTextColor(105, 101, 92);

  doc.text(
    'PH Engenharia / Responsável',
    55,
    251,
    {
      align: 'center'
    }
  );

  doc.text(
    kind === 'Recibo'
      ? 'Recebedor'
      : 'Contratado / Cliente',
    155,
    251,
    {
      align: 'center'
    }
  );

  pdfFooter(doc);

  doc.save(
    `${fileSafe(recordMeta().id_obra)}-${fileSafe(kind)}.pdf`
  );
}

function findDoc(id, kind) {

  const key =
    kind === 'Contrato'
      ? 'contratos'
      : kind === 'Recibo'
        ? 'recibos'
        : 'extras';

  return appState.data?.[key]?.find(
    x => String(x.id) === String(id)
  );
}

function generateCajaPdf() {

  if (!appState.current || !pdfAvailable()) return;

  const doc = pdfBase(
    'MEDIÇÃO / CAIXA',
    'RESUMO FÍSICO-FINANCEIRO'
  );

  const total =
    n(appState.data.meta.caixa_valor) ||
    n(appState.current.valor_contrato);

  const pct =
    n(appState.data.caixa.percentualLiberado);

  let y = 80;

  pdfLine(
    doc,
    'Valor-base',
    money(total),
    y
  );

  y += 9;

  pdfLine(
    doc,
    'Percentual liberado',
    pct.toFixed(2) + '%',
    y
  );

  y += 9;

  pdfLine(
    doc,
    'Valor liberado estimado',
    money(total * pct / 100),
    y,
    true
  );

  y += 9;

  pdfLine(
    doc,
    'Saldo a receber',
    money(total * (1 - pct / 100)),
    y,
    true
  );

  y += 17;

  doc.setFont('helvetica', 'bold');

  doc.setFontSize(10);

  doc.setTextColor(145, 116, 72);

  doc.text(
    'CHECKLIST DOCUMENTAL',
    15,
    y
  );

  y += 8;

  caixaChecklistItems.forEach((x, i) => {

    doc.setFont('helvetica', 'normal');

    doc.setFontSize(9);

    doc.setTextColor(60, 60, 56);

    doc.text(
      `${appState.data.caixa.checklist[i] ? '[X]' : '[ ]'} ${x}`,
      17,
      y
    );

    y += 7;
  });

  pdfFooter(doc);

  doc.save(
    `${fileSafe(recordMeta().id_obra)}-medicao-caixa.pdf`
  );
}

function generateFinalReport() {

  if (!appState.current || !pdfAvailable()) return;

  const doc = pdfBase(
    'RELATÓRIO GERENCIAL',
    'CONSOLIDADO DA OBRA'
  );

  const d = appState.data;

  const contract = n(appState.current.valor_contrato);

  const budget = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.orcado),
    0
  );

  const actual = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.realizado),
    0
  );

  const cost = actual + n(d.financeiro.taxas);

  const profit = contract - cost;

  let y = 80;

  [
    ['Contrato', money(contract)],
    ['Orçamento planejado', money(budget)],
    ['Realizado por etapa', money(actual)],
    ['Taxas e despesas', money(d.financeiro.taxas)],
    ['Custo total registrado', money(cost)],
    ['Saldo do contrato', money(contract - cost)],
    ['Resultado projetado', money(profit)],
    ['Avanço físico', weightedProgress().toFixed(1) + '%'],
    [
      'Custo final estimado',
      weightedProgress() > 0
        ? money(cost / (weightedProgress() / 100))
        : 'Sem base'
    ]
  ].forEach((x, i) => {

    if (y > 270) {
      doc.addPage();
      y = 22;
    }

    pdfLine(
      doc,
      x[0],
      x[1],
      y,
      i === 6
    );

    y += 8;
  });

  y += 8;

  doc.setFont('helvetica', 'bold');

  doc.setFontSize(10);

  doc.setTextColor(145, 116, 72);

  doc.text(
    'ORÇADO X REALIZADO',
    15,
    y
  );

  y += 8;

  d.financeiro.etapas.forEach(x => {

    if (y > 270) {
      doc.addPage();
      y = 22;
    }

    pdfLine(
      doc,
      x.nome,
      `Orçado ${money(x.orcado)} · Realizado ${money(x.realizado)} · Saldo ${money(n(x.orcado) - n(x.realizado))}`,
      y
    );

    y += 7;
  });

  pdfFooter(doc);

  doc.save(
    `${fileSafe(appState.current.id_obra)}-relatorio-gerencial.pdf`
  );

  $('#relatorioPreview').textContent =
    `Gerado em ${new Date().toLocaleString('pt-BR')} · Contrato ${money(contract)} · Custo ${money(cost)} · Resultado ${money(profit)}`;
}

// ======================================================
// WHATSAPP
// ======================================================

function shareWhatsApp() {

  if (!appState.current) {
    return toast('Selecione uma obra primeiro.', 'error');
  }

  const d = appState.data;

  const contract = n(appState.current.valor_contrato);

  const budget = d.financeiro.etapas.reduce(
    (s, x) => s + n(x.orcado),
    0
  );

  const real =
    d.financeiro.etapas.reduce(
      (s, x) => s + n(x.realizado),
      0
    ) +
    n(d.financeiro.taxas);

  const msg = `
*PH ENGENHARIA | RESUMO DA OBRA*

Obra: ${appState.current.id_obra}

Cliente: ${appState.current.cliente_nome}

Contrato: ${money(contract)}

Orçado: ${money(budget)}

Realizado: ${money(real)}

Saldo: ${money(contract - real)}

Avanço físico: ${weightedProgress().toFixed(1)}%

Atualizado em: ${new Date().toLocaleString('pt-BR')}
  `;

  window.open(
    'https://wa.me/?text=' + encodeURIComponent(msg),
    '_blank',
    'noopener'
  );
}

// ======================================================
// INTEGRAÇÃO COM PORTAL DO CLIENTE
// ======================================================

// Mantém as rotas do server.js já existentes:
// /api/config
// /api/arquivos
// /api/atualizacoes

async function loadLinkedPortalData() {

  appState.files = [];

  appState.updates = [];

  const clientId = appState.current?.cliente_id;

  if (!clientId) {

    $('#uploadHint').textContent =
      'Vincule esta obra a um cadastro do portal para enviar arquivos e publicar atualizações.';

    $('#listaArquivos').innerHTML = `
      <div class="record-empty">
        <i class="fa-solid fa-link-slash"></i>
        <strong>Obra sem vínculo com o portal</strong>
        <span>Edite o cadastro e selecione um cliente existente.</span>
      </div>
    `;

    $('#listaAtualizacoes').innerHTML = '';

    $('#uploadForm')
      .querySelector('button[type="submit"]')
      .disabled = true;

    $('#updateClientForm')
      .querySelector('button[type="submit"]')
      .disabled = true;

    return;
  }

  $('#uploadHint').textContent =
    'Os arquivos enviados também ficarão disponíveis na área do cliente vinculada.';

  $('#uploadForm')
    .querySelector('button[type="submit"]')
    .disabled = false;

  $('#updateClientForm')
    .querySelector('button[type="submit"]')
    .disabled = false;

  const id = encodeURIComponent(clientId);

  const [f, u] = await Promise.allSettled([

    api('/api/arquivos?cliente_id=' + id),

    api('/api/atualizacoes?cliente_id=' + id)
  ]);

  appState.files =
    f.status === 'fulfilled' && Array.isArray(f.value)
      ? f.value
      : [];

  appState.updates =
    u.status === 'fulfilled' && Array.isArray(u.value)
      ? u.value
      : [];

  renderLinkedFiles();

  renderLinkedUpdates();
}

function renderLinkedFiles() {

  const a = appState.files;

  if (!a.length) {

    $('#listaArquivos').innerHTML = `
      <div class="field-help">
        Nenhum arquivo compartilhado nesta obra.
      </div>
    `;

    return;
  }

  $('#listaArquivos').innerHTML = a.map(x => `
    <div class="record-chip">

      <span>

        <strong>
          ${esc(x.nome || 'Arquivo')}
        </strong>

        <br>

        <small>
          ${esc(x.categoria || 'Documento')}
          ·
          ${formatDate(x.created_at)}
        </small>

      </span>

      <span class="inline-actions">

        <a
          href="${esc(x.url)}"
          target="_blank"
          rel="noopener"
          class="btn-quiet btn-small"
        >
          Abrir
        </a>

        <button
          type="button"
          class="btn-danger btn-small"
          data-delete-file="${esc(x.id)}"
        >
          <i class="fa-solid fa-trash"></i>
        </button>

      </span>

    </div>
  `).join('');
}

function renderLinkedUpdates() {

  $('#listaAtualizacoes').innerHTML = appState.updates.length

    ? appState.updates.slice(0, 5).map(x => `
        <div class="record-chip" style="display:block">

          <strong>
            ${esc(x.titulo || 'Atualização')}
          </strong>

          <small style="display:block">
            ${formatDate(x.created_at)}
          </small>

          <p style="margin-top:5px">
            ${esc(x.descricao || '')}
          </p>

        </div>
      `).join('')

    : `
      <div class="field-help">
        Nenhuma atualização publicada.
      </div>
    `;
}

async function uploadLinkedFile(ev) {

  ev.preventDefault();

  const clientId = appState.current?.cliente_id;

  const file = $('#arquivoObra').files?.[0];

  if (!clientId) {
    return toast(
      'Vincule um cliente do portal antes de enviar arquivos.',
      'error'
    );
  }

  if (!file) {
    return toast('Selecione um arquivo.', 'error');
  }

  if (file.size > 15 * 1024 * 1024) {
    return toast('O arquivo excede 15 MB.', 'error');
  }

  const btn = $('#uploadForm')
    .querySelector('button[type="submit"]');

  btn.disabled = true;

  try {

    const cr = await fetch('/api/config', {
      cache: 'no-store'
    });

    if (!cr.ok) {
      throw new Error(
        'Não foi possível carregar a configuração de arquivos.'
      );
    }

    const config = await cr.json();

    if (
      !config.cloudinaryName ||
      !config.cloudinaryPreset
    ) {
      throw new Error(
        'Configure CLOUDINARY_CLOUD_NAME e CLOUDINARY_PRESET no Render.'
      );
    }

    const fd = new FormData();

    fd.append('file', file);

    fd.append(
      'upload_preset',
      config.cloudinaryPreset
    );

    const ur = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryName)}/auto/upload`,
      {
        method: 'POST',
        body: fd
      }
    );

    const uploaded = await ur.json();

    if (!ur.ok || !uploaded.secure_url) {

      throw new Error(
        uploaded.error?.message ||
        'O serviço de arquivos recusou o envio.'
      );
    }

    await api('/api/arquivos', {

      method: 'POST',

      body: JSON.stringify({

        cliente_id: clientId,

        nome: file.name,

        url: uploaded.secure_url,

        public_id: uploaded.public_id,

        categoria: $('#arquivoCategoria').value,

        etapa: $('#arquivoEtapa').value,

        descricao: $('#arquivoDescricao').value.trim()
      })
    });

    $('#uploadForm').reset();

    await loadLinkedPortalData();

    toast(
      'Arquivo enviado ao portal do cliente.',
      'success'
    );

  } catch (e) {

    toast(e.message, 'error');

  } finally {

    btn.disabled = false;

    btn.innerHTML =
      '<i class="fa-solid fa-cloud-arrow-up"></i> Enviar arquivo';
  }
}

async function deleteLinkedFile(id) {

  const f = appState.files.find(
    x => String(x.id) === String(id)
  );

  if (
    !f ||
    !confirm(`Excluir o arquivo "${f.nome}" do portal do cliente?`)
  ) {
    return;
  }

  try {

    await api(
      '/api/arquivos?id=' + encodeURIComponent(id),
      {
        method: 'DELETE'
      }
    );

    await loadLinkedPortalData();

    toast(
      'Arquivo removido.',
      'success'
    );

  } catch (e) {

    toast(e.message, 'error');
  }
}

async function publishClientUpdate(ev) {

  ev.preventDefault();

  const clientId = appState.current?.cliente_id;

  if (!clientId) {
    return toast(
      'Vincule um cliente do portal antes de publicar.',
      'error'
    );
  }

  const titulo = $('#updateTitulo').value.trim();

  const descricao = $('#updateDescricao').value.trim();

  if (!titulo || !descricao) {
    return toast(
      'Preencha título e descrição.',
      'error'
    );
  }

  const btn = $('#updateClientForm')
    .querySelector('button[type="submit"]');

  btn.disabled = true;

  try {

    await api('/api/atualizacoes', {

      method: 'POST',

      body: JSON.stringify({

        cliente_id: clientId,

        titulo,

        descricao
      })
    });

    $('#updateClientForm').reset();

    await loadLinkedPortalData();

    toast(
      'Atualização publicada no portal.',
      'success'
    );

  } catch (e) {

    toast(e.message, 'error');

  } finally {

    btn.disabled = false;

    btn.innerHTML =
      '<i class="fa-solid fa-paper-plane"></i> Publicar no portal';
  }
}

// ======================================================
// BACKUP E EXPORTAÇÃO
// ======================================================

function downloadBlob(content, name, type) {

  const blob = new Blob(
    [content],
    { type }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');

  a.href = url;

  a.download = name;

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1500
  );
}

function exportBackup() {

  if (!appState.current) return;

  const backup = {

    sistema: 'PH Engenharia Minha Obra',

    versao: 2,

    exportado_em: new Date().toISOString(),

    obra: appState.current,

    dados: appState.data
  };

  downloadBlob(
    JSON.stringify(backup, null, 2),
    `${fileSafe(appState.current.id_obra)}-backup.json`,
    'application/json;charset=utf-8'
  );

  toast(
    'Backup JSON exportado.',
    'success'
  );
}

function csvEscape(v) {

  return '"' +
    String(v ?? '').replace(/"/g, '""') +
    '"';
}

function exportCsv() {

  if (!appState.current || !appState.data) return;

  const d = appState.data;

  const rows = [[
    'Grupo',
    'Descrição',
    'Quantidade / Orçado',
    'Realizado / Valor',
    'Detalhe'
  ]];

  d.financeiro.etapas.forEach(x =>

    rows.push([
      'Orçamento',
      x.nome,
      n(x.orcado),
      n(x.realizado),
      'Etapa'
    ])
  );

  d.fornecedores.forEach(x =>

    rows.push([
      'Fornecedor',
      x.empresa,
      0,
      n(x.valor),
      `Serviço: ${x.servico}; Nota: ${x.nota}; Atraso: ${x.atraso}`
    ])
  );

  d.estoque.forEach(x =>

    rows.push([
      'Estoque',
      x.material,
      n(x.comprado),
      n(x.utilizado),
      `Unidade: ${x.unidade}; Saldo: ${n(x.comprado) - n(x.utilizado)}`
    ])
  );

  d.fluxo.forEach(x =>

    rows.push([
      'Fluxo de caixa',
      x.descricao,
      x.tipo === 'entrada' ? n(x.valor) : 0,
      x.tipo === 'saida' ? n(x.valor) : 0,
      formatDate(x.data)
    ])
  );

  d.compras.forEach(x =>

    rows.push([
      'Compra',
      x.material,
      n(x.quantidade),
      n(x.preco) * n(x.quantidade),
      `Unidade: ${x.unidade}; Status: ${x.status}; Fornecedor: ${x.fornecedor}`
    ])
  );

  d.cotacoes.forEach(x => {

    const item = d.compras.find(
      c => String(c.id) === String(x.compraId)
    );

    rows.push([
      'Cotação',
      item?.material || 'Item',
      n(x.preco),
      '',
      `Fornecedor: ${x.fornecedor}; Prazo: ${x.prazoEntrega || ''}; Validade: ${formatDate(x.validade)}; Condições: ${x.condicoes || ''}`
    ]);
  });

  d.contas.forEach(x =>

    rows.push([
      'Conta',
      x.descricao,
      n(x.valor),
      x.status,
      `${x.tipo}; Vencimento: ${formatDate(x.vencimento)}; ${x.favorecido || ''}`
    ])
  );

  d.cronogramaFisico.forEach(x =>

    rows.push([
      'Cronograma',
      x.nome,
      n(x.peso),
      n(x.avanco),
      `Início: ${formatDate(x.inicio)}; Fim: ${formatDate(x.fim)}; Responsável: ${x.responsavel}`
    ])
  );

  d.diario.forEach(x =>

    rows.push([
      'Diário',
      x.data,
      '',
      '',
      x.atividades
    ])
  );

  d.historico.forEach(x =>

    rows.push([
      'Histórico',
      x.evento,
      x.data,
      '',
      x.origem
    ])
  );

  const csv =
    '\uFEFF' +
    rows.map(r =>
      r.map(csvEscape).join(';')
    ).join('\r\n');

  downloadBlob(
    csv,
    `${fileSafe(appState.current.id_obra)}-gestao.csv`,
    'text/csv;charset=utf-8'
  );

  toast(
    'CSV exportado.',
    'success'
  );
}

async function importBackup(ev) {

  const file = ev.target.files?.[0];

  ev.target.value = '';

  if (!file || !appState.current) return;

  try {

    const parsed = JSON.parse(await file.text());

    if (
      !parsed.dados ||
      typeof parsed.dados !== 'object'
    ) {
      throw new Error(
        'Arquivo não contém os dados esperados.'
      );
    }

    if (
      parsed.obra?.id_obra &&
      parsed.obra.id_obra !== appState.current.id_obra
    ) {
      throw new Error(
        'Este backup pertence a outra obra.'
      );
    }

    if (!confirm(
      `Restaurar backup sobre ${appState.current.id_obra}? Os dados atuais serão substituídos.`
    )) {
      return;
    }

    appState.data = mergeData(parsed.dados, {});

    appState.dirty = true;

    appState.revision++;

    await saveCurrent(false);

    if (appState.dirty) {
      throw new Error(
        'Não foi possível sincronizar o backup.'
      );
    }

    renderAll();

    toast(
      'Backup restaurado e sincronizado.',
      'success'
    );

  } catch (e) {

    toast(
      e.message || 'Falha ao restaurar backup.',
      'error'
    );
  }
}

// ======================================================
// EXCLUIR OBRA
// ======================================================

async function deleteCurrentRecord() {

  if (!appState.current) return;

  const r = appState.current;

  if (!confirm(
    `Excluir a gestão da obra ${r.id_obra} (${r.cliente_nome})?\n\nOs dados do ERP desta obra serão removidos. O cadastro do cliente no portal não será excluído.`
  )) {
    return;
  }

  try {

    await api(
      '/api/erp/obras/' + encodeURIComponent(r.id),
      {
        method: 'DELETE'
      }
    );

    toast(
      'Gestão da obra excluída.',
      'success'
    );

    appState.current = null;

    appState.data = null;

    await loadInitialData();

  } catch (e) {

    toast(e.message, 'error');
  }
}

// ======================================================
// NAVEGAÇÃO
// ======================================================

function navigateToView(view, opts = {}) {

  if (!Object.hasOwn(viewLabels, view)) {
    view = 'visao-geral';
  }

  if (
    view === 'caixa' &&
    !hasCaixaFinancing()
  ) {
    view = 'visao-geral';
  }

  $$('.erp-section').forEach(s => {

    const active = s.id === view;

    s.classList.toggle('active', active);

    s.setAttribute(
      'aria-hidden',
      active ? 'false' : 'true'
    );
  });

  $$('#erpNavigation [data-view]').forEach(b => {

    const active = b.dataset.view === view;

    b.classList.toggle('active', active);

    if (active) {
      b.setAttribute('aria-current', 'page');

    } else {
      b.removeAttribute('aria-current');
    }
  });

  $('#activeViewLabel').textContent =
    viewLabels[view];

  if (opts.updateHistory !== false) {

    const hash = '#' + view;

    if (location.hash !== hash) {

      history.pushState(
        { erpView: view },
        '',
        location.pathname + location.search + hash
      );
    }
  }

  if (opts.scroll !== false) {

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}

function getViewFromUrl() {

  let v = '';

  try {

    v = decodeURIComponent(
      (location.hash || '').replace(/^#/, '')
    );

  } catch {}

  return Object.hasOwn(viewLabels, v)
    ? v
    : 'visao-geral';
}

// ======================================================
// EVENTOS
// ======================================================

function wireEvents() {

  document
    .querySelectorAll('button:not([type])')
    .forEach(b => {
      b.type = 'button';
    });

  $('#erpNavigation').addEventListener('click', ev => {

    const b = ev.target.closest('[data-view]');

    if (b) {

      ev.preventDefault();

      navigateToView(b.dataset.view);
    }
  });

  window.addEventListener('popstate', () => {

    navigateToView(
      getViewFromUrl(),
      {
        updateHistory: false
      }
    );
  });

  $('#btnSair').addEventListener(
    'click',
    logoutERP
  );

  $('#btnNovaObra').addEventListener(
    'click',
    () => openNewModal()
  );

  $('#btnEditarObra').addEventListener(
    'click',
    () => appState.current && openNewModal(appState.current)
  );

  $('#btnExcluirObra').addEventListener(
    'click',
    deleteCurrentRecord
  );

  $('#btnSalvar').addEventListener(
    'click',
    () => saveCurrent(true)
  );

  $('#btnBackup').addEventListener(
    'click',
    exportBackup
  );

  $('#btnCsv').addEventListener(
    'click',
    exportCsv
  );

  $('#btnImportBackup').addEventListener(
    'click',
    () => $('#backupFile').click()
  );

  $('#backupFile').addEventListener(
    'change',
    importBackup
  );

  $('#obraSelecionada').addEventListener(
    'change',
    ev => openRecord(ev.target.value)
  );

  $('#btnFecharModal').addEventListener(
    'click',
    closeModal
  );

  $('#btnCancelarObra').addEventListener(
    'click',
    closeModal
  );

  $('#modalObra').addEventListener('click', ev => {

    if (ev.target === $('#modalObra')) {
      closeModal();
    }
  });

  $('#tipoObraCadastro').addEventListener(
    'change',
    updateCaixaFormVisibility
  );

  $('#obraForm').addEventListener(
    'submit',
    submitWorkForm
  );

  $('#clienteVinculado').addEventListener('change', ev => {

    const c = appState.portalClients.find(
      x => String(x.id) === ev.target.value
    );

    if (c) {

      if (!$('#nomeCliente').value.trim()) {
        $('#nomeCliente').value = c.nome || '';
      }

      if (!$('#enderecoObra').value.trim()) {
        $('#enderecoObra').value = c.endereco_obra || '';
      }
    }
  });

  $('#btnAddEtapa').addEventListener(
    'click',
    addStage
  );

  $('#btnAddFornecedor').addEventListener(
    'click',
    addFornecedor
  );

  $('#btnAddEstoque').addEventListener(
    'click',
    addStock
  );

  $('#fluxoForm').addEventListener(
    'submit',
    addCashflow
  );

  $('#cotacaoForm').addEventListener(
    'submit',
    addCotacao
  );

  $('#cronogramaForm').addEventListener(
    'submit',
    addCronograma
  );

  $('#diarioForm').addEventListener(
    'submit',
    addDiario
  );

  $('#compraForm').addEventListener(
    'submit',
    addCompra
  );

  $('#contaForm').addEventListener(
    'submit',
    addConta
  );

  // Contratos

  $('#contratoForm').addEventListener('submit', ev => {

    ev.preventDefault();

    if (!appState.current) {
      return toast('Selecione uma obra primeiro.', 'error');
    }

    const item = {

      nome: $('#contratoNome').value.trim(),

      documento: $('#contratoDoc').value.trim(),

      titulo: $('#contratoObjeto').value.trim(),

      valor: n($('#contratoValor').value),

      prazo: $('#contratoPrazo').value.trim(),

      data: todayISO()
    };

    if (
      !item.nome ||
      !item.titulo ||
      item.valor <= 0
    ) {
      return toast(
        'Preencha nome, objeto e valor.',
        'error'
      );
    }

    addDocument(
      'contratos',
      item,
      'Contrato'
    );

    $('#contratoForm').reset();
  });

  // Recibos

  $('#reciboForm').addEventListener('submit', ev => {

    ev.preventDefault();

    if (!appState.current) {
      return toast('Selecione uma obra primeiro.', 'error');
    }

    const item = {

      nome: $('#reciboNome').value.trim(),

      documento: $('#reciboDoc').value.trim(),

      valor: n($('#reciboValor').value),

      descricao: $('#reciboRef').value.trim(),

      data: $('#reciboData').value
    };

    if (
      !item.nome ||
      item.valor <= 0 ||
      !item.descricao ||
      !item.data
    ) {
      return toast(
        'Preencha os campos obrigatórios do recibo.',
        'error'
      );
    }

    addDocument(
      'recibos',
      item,
      'Recibo'
    );

    $('#reciboForm').reset();

    $('#reciboData').value = todayISO();
  });

  // Serviços extras

  $('#extraForm').addEventListener('submit', ev => {

    ev.preventDefault();

    if (!appState.current) {
      return toast('Selecione uma obra primeiro.', 'error');
    }

    const item = {

      descricao: $('#extraDesc').value.trim(),

      valor: n($('#extraValor').value),

      status: $('#extraStatus').value,

      data: todayISO()
    };

    if (
      !item.descricao ||
      item.valor <= 0
    ) {
      return toast(
        'Informe descrição e valor do extra.',
        'error'
      );
    }

    addDocument(
      'extras',
      item,
      'Orçamento extra'
    );

    $('#extraForm').reset();
  });

  $('#btnPdfCaixa').addEventListener(
    'click',
    generateCajaPdf
  );

  $('#btnResetCronograma').addEventListener('click', () => {

    if (!appState.data) return;

    appState.data.caixa.cronograma =
      JSON.parse(JSON.stringify(cronogramaBase));

    renderCaixa();

    markDirty('Cronograma CAIXA restaurado');
  });

  $('#btnRelatorio').addEventListener(
    'click',
    generateFinalReport
  );

  $('#btnWhats').addEventListener(
    'click',
    shareWhatsApp
  );

  $('#btnCompararObras').addEventListener(
    'click',
    renderWorkComparison
  );

  $('#uploadForm').addEventListener(
    'submit',
    uploadLinkedFile
  );

  $('#updateClientForm').addEventListener(
    'submit',
    publishClientUpdate
  );

  $('#btnEnviarCalculosCompras').addEventListener(
    'click',
    sendCalcToPurchases
  );

  $('#btnEnviarCalculosCompras2').addEventListener(
    'click',
    sendCalcToPurchases
  );

  $('#filtroCompras').addEventListener(
    'input',
    renderCompras
  );

  $('#filtroStatusCompra').addEventListener(
    'change',
    renderCompras
  );

  $('#filtroHistorico').addEventListener(
    'change',
    renderHistorico
  );

  // Edições gerais.

  document.addEventListener('input', ev => {

    const el = ev.target;

    if (
      el.matches('[data-collection],[data-scope]') &&
      !el.matches('select,[type="checkbox"]')
    ) {
      onFieldEdit(ev);
    }

    if (el.closest('#calculadoras')) {
      calcAll();
    }
  });

  document.addEventListener('change', ev => {

    const el = ev.target;

    if (el.matches('[data-collection],[data-scope]')) {
      onFieldEdit(ev);
    }

    if (el.closest('#calculadoras')) {
      calcAll();
    }
  });

  // Ações dinâmicas das tabelas.

  document.addEventListener('click', ev => {

    const openWork = ev.target.closest('[data-open-work]');

    if (openWork) {

      openRecord(openWork.dataset.openWork);

      return;
    }

    const useQuote = ev.target.closest('[data-use-quote]');

    if (useQuote) {

      applyCotacao(useQuote.dataset.useQuote);

      return;
    }

    const rm = ev.target.closest('[data-remove]');

    if (rm) {

      if (rm.dataset.remove === 'contas') {

        const x =
          appState.data.contas[Number(rm.dataset.index)];

        if (x?.fluxoId) {

          if (!confirm(
            'Esta conta já gerou lançamento no fluxo. Excluí-la também removerá esse lançamento. Continuar?'
          )) {
            return;
          }

          appState.data.fluxo =
            appState.data.fluxo.filter(
              f => String(f.id) !== String(x.fluxoId)
            );
        }
      }

      removeItem(
        rm.dataset.remove,
        rm.dataset.index
      );

      return;
    }

    const delFlow = ev.target.closest('[data-flow-delete]');

    if (delFlow) {

      const flow = appState.data.fluxo.find(
        x => String(x.id) === String(delFlow.dataset.flowDelete)
      );

      if (flow?.accountId) {

        const account = appState.data.contas.find(
          x => String(x.id) === String(flow.accountId)
        );

        if (account) {

          account.status = 'aberta';

          account.fluxoId = null;

          account.dataBaixa = null;
        }
      }

      appState.data.fluxo =
        appState.data.fluxo.filter(
          x => String(x.id) !== String(delFlow.dataset.flowDelete)
        );

      renderAll();

      markDirty('Movimentação removida');

      return;
    }

    const settle = ev.target.closest('[data-settle-account]');

    if (settle) {

      settleAccount(settle.dataset.settleAccount);

      return;
    }

    const reopen = ev.target.closest('[data-reopen-account]');

    if (reopen) {

      reopenAccount(reopen.dataset.reopenAccount);

      return;
    }

    const pdf = ev.target.closest('[data-doc-pdf]');

    if (pdf && appState.data) {

      const item = findDoc(
        pdf.dataset.docPdf,
        pdf.dataset.docKind
      );

      if (item) {
        generateDocumentPdf(
          pdf.dataset.docKind,
          item
        );
      }

      return;
    }

    const file = ev.target.closest('[data-delete-file]');

    if (file) {
      deleteLinkedFile(file.dataset.deleteFile);
    }
  });
}

// ======================================================
// INICIALIZAÇÃO
// ======================================================

async function init() {

  // Substitui qualquer formulário antigo:
  // a autenticação acontece somente na página externa.

  showSessionGate(
    'Verificando se já existe uma sessão administrativa ativa...'
  );

  $('#currentDate').textContent =
    new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });

  $('#fluxoData').value = todayISO();

  $('#reciboData').value = todayISO();

  $('#diData').value = todayISO();

  $('#ctVencimento').value = todayISO();

  $('#coData').value = todayISO();

  $('#cotValidade').value = todayISO();

  $('#arquivoEtapa').innerHTML =
    '<option value="">Sem etapa específica</option>' +

    stageNames.map(x => `
      <option value="${esc(x)}">
        ${esc(x)}
      </option>
    `).join('');

  wireEvents();

  navigateToView(
    getViewFromUrl(),
    {
      updateHistory: false,
      scroll: false
    }
  );

  calcAll();

  // O login é feito em outra página.
  // Esta tela apenas verifica a sessão já criada.

  await checkERPSession();
}

init().catch(e => {

  console.error(e);

  setConnection(
    false,
    'Falha na inicialização'
  );

  showSessionGate(
    'Falha ao iniciar o ERP: ' +
    (e.message || 'erro inesperado.')
  );
});
