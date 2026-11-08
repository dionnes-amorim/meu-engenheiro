'use strict';

/*
 * PH ENGENHARIA — API do módulo Minha Obra / ERP.
 *
 * Integração no server.js:
 *   const registerErpApi = require('./erp-api');
 *   app.set('trust proxy', 1); // imediatamente após const app = express();
 *   ...
 *   app.use(express.json({ limit: '1mb' }));
 *   ... rotas já existentes do portal do cliente ...
 *   registerErpApi(app); // antes de express.static(...)
 *
 * Compatível com o frontend minha-obra-corrigido.html:
 *   GET    /api/erp/session
 *   POST   /api/erp/login
 *   POST   /api/erp/logout
 *   GET    /api/erp/obras
 *   GET    /api/erp/clientes
 *   POST   /api/erp/obras
 *   GET    /api/erp/obras/:id
 *   PUT    /api/erp/obras/:id
 *   DELETE /api/erp/obras/:id
 *
 * As rotas /api/arquivos, /api/atualizacoes e /api/config continuam
 * sendo responsabilidade do server.js existente. Não duplicá-las aqui.
 * Requer Node.js 18+ (fetch nativo) e Express.
 */

const crypto = require('node:crypto');

module.exports = function registerErpApi(app) {
  if (!app || typeof app.get !== 'function' || typeof app.use !== 'function') {
    throw new TypeError('registerErpApi precisa receber uma instância válida do Express.');
  }

  const COOKIE_NAME = 'ph_erp_admin';
  const SESSION_SECONDS = 60 * 60 * 10; // 10 horas
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX_ATTEMPTS = 8;
  const MAX_MONEY = 999999999999.99; // numeric(14,2)
  const loginAttempts = new Map();

  // ============================================================
  // CONFIGURAÇÃO
  // ============================================================

  function config() {
    return {
      url: String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
      key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    };
  }

  function sessionSecret() {
    // O fallback mantém compatibilidade com a configuração anterior.
    return String(
      process.env.ERP_SESSION_SECRET ||
      process.env.ERP_ADMIN_PASSWORD ||
      ''
    );
  }

  function isConfigured() {
    const { url, key } = config();
    return Boolean(
      process.env.ERP_ADMIN_PASSWORD &&
      sessionSecret() &&
      url &&
      key
    );
  }

  // ============================================================
  // SEGURANÇA / SESSÃO
  // ============================================================

  function safeEqual(left, right) {
    const a = Buffer.from(String(left ?? ''), 'utf8');
    const b = Buffer.from(String(right ?? ''), 'utf8');

    // timingSafeEqual exige buffers do mesmo tamanho.
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  function signature(expiry) {
    const secret = sessionSecret();
    if (!secret) return '';

    return crypto
      .createHmac('sha256', secret)
      .update(String(expiry), 'utf8')
      .digest('base64url');
  }

  function readCookie(req, name) {
    const header = String(req.headers.cookie || '');
    const prefix = `${name}=`;
    const item = header
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(prefix));

    if (!item) return '';

    try {
      return decodeURIComponent(item.slice(prefix.length));
    } catch {
      return '';
    }
  }

  function isAuthenticated(req) {
    if (!sessionSecret()) return false;

    const token = readCookie(req, COOKIE_NAME);
    const pieces = token.split('.');
    if (pieces.length !== 2) return false;

    const expiry = Number(pieces[0]);
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isSafeInteger(expiry) || expiry <= now) {
      return false;
    }

    const expected = signature(expiry);
    return Boolean(expected) && safeEqual(pieces[1], expected);
  }

  function cookieOptions(req) {
    const forwardedProto = String(
      req.headers['x-forwarded-proto'] || ''
    ).split(',')[0].trim().toLowerCase();

    const secure =
      process.env.NODE_ENV === 'production' ||
      req.secure === true ||
      forwardedProto === 'https';

    return {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_SECONDS * 1000
    };
  }

  function setSessionCookie(req, res, token) {
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
  }

  function clearSessionCookie(req, res) {
    const options = cookieOptions(req);
    delete options.maxAge;
    res.clearCookie(COOKIE_NAME, options);
  }

  function requireAdmin(req, res, next) {
    if (!isAuthenticated(req)) {
      return res.status(401).json({
        error: 'Sessão administrativa expirada. Entre novamente.'
      });
    }
    return next();
  }

  // Disponibiliza o middleware para rotas complementares do server.js.
  app.locals = app.locals || {};
  app.locals.requireErpAdmin = requireAdmin;

  function sameOrigin(req, res, next) {
    const originHeader = req.get('origin');
    const refererHeader = req.get('referer');

    // Alguns clientes não enviam Origin. O cookie SameSite=Strict continua
    // sendo uma segunda barreira nesses casos.
    if (!originHeader && !refererHeader) return next();

    try {
      const supplied = originHeader
        ? new URL(originHeader)
        : new URL(refererHeader);

      const host = req.get('host');
      const forwardedProto = String(
        req.headers['x-forwarded-proto'] || ''
      ).split(',')[0].trim().toLowerCase();

      const protocol = req.secure || forwardedProto === 'https'
        ? 'https:'
        : `${req.protocol || 'http'}:`;

      const expectedOrigin = `${protocol}//${host}`;

      if (!host || supplied.origin !== expectedOrigin) {
        return res.status(403).json({ error: 'Origem não autorizada.' });
      }

      return next();
    } catch {
      return res.status(403).json({ error: 'Origem inválida.' });
    }
  }

  function noStore(_req, res, next) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    return next();
  }

  // ============================================================
  // VALIDAÇÕES E NORMALIZAÇÃO
  // ============================================================

  function validationError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
  }

  function cleanText(value, max = 300) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max);
  }

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || ''));
  }

  function validCpf(value) {
    const cpf = String(value || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += Number(cpf[i]) * (10 - i);
    }

    let digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    if (digit !== Number(cpf[9])) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += Number(cpf[i]) * (11 - i);
    }

    digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    return digit === Number(cpf[10]);
  }

  function money(value) {
    if (value === null || value === undefined || value === '') return 0;

    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      number < 0 ||
      number > MAX_MONEY
    ) {
      throw validationError('O valor do contrato deve ser um número válido e não negativo.');
    }

    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  function validIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  }

  function normalizeRecord(body) {
    const b = body && typeof body === 'object' && !Array.isArray(body)
      ? body
      : {};

    const idObra = cleanText(b.id_obra, 80);
    const cpf = cleanText(b.cpf, 20).replace(/\D/g, '');
    const clienteNome = cleanText(b.cliente_nome, 160);
    const tipo = cleanText(b.tipo, 40) || 'particular';
    const dataInicioRaw = cleanText(b.data_inicio, 10);

    const clienteId = b.cliente_id === null ||
      b.cliente_id === undefined ||
      b.cliente_id === ''
      ? null
      : String(b.cliente_id).trim();

    if (!idObra || !validCpf(cpf) || !clienteNome) {
      throw validationError('Informe ID da obra, nome do cliente e CPF válido.');
    }

    if (clienteId && !validUuid(clienteId)) {
      throw validationError('O vínculo com o cadastro do cliente é inválido.');
    }

    if (dataInicioRaw && !validIsoDate(dataInicioRaw)) {
      throw validationError('A data de início informada é inválida.');
    }

    const dados = b.dados &&
      typeof b.dados === 'object' &&
      !Array.isArray(b.dados)
      ? b.dados
      : {};

    let dadosJson;
    try {
      dadosJson = JSON.stringify(dados);
    } catch {
      throw validationError('Os dados internos da obra possuem conteúdo inválido.');
    }

    // A API aceita o objeto completo do frontend sem filtrar os módulos.
    // O limite do Express (1 MB) continua sendo a proteção principal do body.
    if (Buffer.byteLength(dadosJson || '{}', 'utf8') > 950 * 1024) {
      throw validationError('Os dados da obra excedem o limite permitido.');
    }

    return {
      id_obra: idObra,
      cpf,
      cliente_nome: clienteNome,
      telefone: cleanText(b.telefone, 40) || null,
      endereco: cleanText(b.endereco, 350) || null,
      tipo,
      data_inicio: dataInicioRaw || null,
      valor_contrato: money(b.valor_contrato),
      cliente_id: clienteId,
      status: cleanText(b.status, 40) || 'Em andamento',
      dados
    };
  }

  // ============================================================
  // SUPABASE REST
  // ============================================================

  async function db(table, method = 'GET', query = '', body = null) {
    const { url, key } = config();

    if (!url || !key) {
      const error = new Error(
        'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.'
      );
      error.status = 503;
      throw error;
    }

    // As tabelas usadas por este módulo são constantes internas.
    if (!/^[a-z][a-z0-9_]*$/i.test(table)) {
      throw new Error('Tabela de banco inválida.');
    }

    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    };

    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = 'return=representation';
    }

    // Em DELETE também é necessário pedir representation para que a rota
    // consiga confirmar se o registro existia antes de responder sucesso.
    if (method === 'DELETE') {
      headers.Prefer = 'return=representation';
    }

    let response;

    try {
      response = await fetch(`${url}/rest/v1/${table}${query}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body)
      });
    } catch (cause) {
      const error = new Error(
        'Não foi possível conectar ao Supabase. Verifique a rede e as variáveis do Render.'
      );
      error.status = 502;
      error.cause = cause;
      throw error;
    }

    const raw = await response.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    if (!response.ok) {
      const error = new Error(
        data && typeof data === 'object'
          ? (
              data.message ||
              data.details ||
              data.hint ||
              `Falha no banco (${response.status}).`
            )
          : (data || `Falha no banco (${response.status}).`)
      );

      error.status = response.status;
      error.code = data && typeof data === 'object' ? data.code : undefined;
      error.details = data && typeof data === 'object' ? data.details : undefined;

      throw error;
    }

    return data;
  }

  // ============================================================
  // TRATAMENTO PADRÃO DE ERROS
  // ============================================================

  function sendRouteError(res, error, context, fallback) {
    console.error(`[ERP ${context}]`, {
      message: error?.message,
      status: error?.status,
      code: error?.code,
      details: error?.details
    });

    if (
      error?.code === '23505' ||
      /duplicate key|unique constraint/i.test(error?.message || '')
    ) {
      return res.status(409).json({
        error: 'Este ID de obra já está cadastrado. Gere outro identificador.'
      });
    }

    if (error?.code === '23503') {
      return res.status(400).json({
        error: 'O cliente selecionado não existe mais no cadastro do portal. Atualize a lista de clientes e tente novamente.'
      });
    }

    const status = Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status <= 499
      ? error.status
      : (
          error?.status === 502 || error?.status === 503
            ? error.status
            : 500
        );

    // Mensagens de validação são úteis para o formulário. Erros internos
    // permanecem no log do servidor e recebem texto seguro no navegador.
    const message = status === 400
      ? (error.message || fallback)
      : (
          status === 401 ||
          status === 403 ||
          status === 404 ||
          status === 409 ||
          status === 429 ||
          status === 503
        )
        ? (error.message || fallback)
        : fallback;

    return res.status(status).json({ error: message });
  }

  function notFoundError(message) {
    const error = new Error(message);
    error.status = 404;
    return error;
  }

  // ============================================================
  // SESSÃO ADMINISTRATIVA
  // Estas rotas ficam antes do middleware de proteção.
  // ============================================================

  app.get('/api/erp/session', noStore, (req, res) => {
    return res.json({
      authenticated: isAuthenticated(req),
      configured: isConfigured()
    });
  });

  // ============================================================
  // LOGIN COM LIMITAÇÃO DE TENTATIVAS
  // ============================================================

  app.post('/api/erp/login', noStore, sameOrigin, (req, res) => {
    const { url, key } = config();
    const configuredPassword = process.env.ERP_ADMIN_PASSWORD || '';

    if (!configuredPassword || !sessionSecret() || !url || !key) {
      return res.status(503).json({
        error: 'Configure ERP_ADMIN_PASSWORD, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render. Recomenda-se também definir ERP_SESSION_SECRET com um segredo longo e aleatório.'
      });
    }

    const ip = String(
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown'
    ).slice(0, 120);

    const now = Date.now();
    let record = loginAttempts.get(ip);

    if (!record || record.resetAt <= now) {
      record = {
        count: 0,
        resetAt: now + LOGIN_WINDOW_MS
      };
    }

    if (record.count >= LOGIN_MAX_ATTEMPTS) {
      const retrySeconds = Math.max(
        1,
        Math.ceil((record.resetAt - now) / 1000)
      );

      res.set('Retry-After', String(retrySeconds));

      loginAttempts.set(ip, record);

      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'
      });
    }

    const password = String(req.body?.password || '');

    if (!safeEqual(password, configuredPassword)) {
      record.count += 1;
      loginAttempts.set(ip, record);

      // Limpa registros antigos para evitar crescimento indefinido do Map.
      if (loginAttempts.size > 5000) {
        for (const [key, value] of loginAttempts) {
          if (!value || value.resetAt <= now) {
            loginAttempts.delete(key);
          }
        }
      }

      return res.status(401).json({
        error: 'Senha administrativa incorreta.'
      });
    }

    loginAttempts.delete(ip);

    const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const token = `${expiry}.${signature(expiry)}`;

    setSessionCookie(req, res, token);

    return res.json({
      success: true,
      expires_in: SESSION_SECONDS
    });
  });

  // ============================================================
  // LOGOUT
  // ============================================================

  app.post('/api/erp/logout', noStore, sameOrigin, (req, res) => {
    clearSessionCookie(req, res);

    return res.json({
      success: true
    });
  });

  // ============================================================
  // PROTEÇÃO DAS DEMAIS ROTAS ERP
  // Não protege /api/arquivos nem /api/atualizacoes, que pertencem
  // ao portal do cliente e continuam no server.js original.
  // ============================================================

  app.use('/api/erp', noStore, sameOrigin, requireAdmin);

  // ============================================================
  // LISTAR OBRAS
  // O HTML usa esses campos para montar o seletor e o comparativo.
  // ============================================================

  app.get('/api/erp/obras', async (_req, res) => {
    try {
      const rows = await db(
        'erp_obras',
        'GET',
        '?select=id,id_obra,cliente_nome,cpf,cliente_id,tipo,valor_contrato,status,updated_at&order=updated_at.desc&limit=1000'
      );

      return res.json(Array.isArray(rows) ? rows : []);

    } catch (error) {
      return sendRouteError(
        res,
        error,
        'listar obras',
        'Não foi possível listar as obras.'
      );
    }
  });

  // ============================================================
  // LISTAR CLIENTES DO PORTAL
  // O HTML espera id, nome, email e endereco_obra.
  // ============================================================

  app.get('/api/erp/clientes', async (_req, res) => {
    try {
      const rows = await db(
        'clientes',
        'GET',
        '?select=id,nome,email,endereco_obra&order=nome.asc&limit=500'
      );

      return res.json(Array.isArray(rows) ? rows : []);

    } catch (error) {
      return sendRouteError(
        res,
        error,
        'listar clientes',
        'Não foi possível carregar a lista de clientes do portal.'
      );
    }
  });

  // ============================================================
  // CADASTRAR OBRA
  // ============================================================

  app.post('/api/erp/obras', async (req, res) => {
    try {
      const payload = normalizeRecord(req.body);

      const rows = await db(
        'erp_obras',
        'POST',
        '?select=*',
        payload
      );

      const record = Array.isArray(rows) ? rows[0] : rows;

      if (!record || !record.id) {
        throw new Error('O Supabase não retornou a obra cadastrada.');
      }

      return res.status(201).json(record);

    } catch (error) {
      return sendRouteError(
        res,
        error,
        'criar obra',
        'Não foi possível criar a obra.'
      );
    }
  });

  // ============================================================
  // CARREGAR UMA OBRA
  // Retorna a linha completa, inclusive o JSONB "dados" do frontend.
  // ============================================================

  app.get('/api/erp/obras/:id', async (req, res) => {
    try {
      if (!validUuid(req.params.id)) {
        throw validationError('Identificador da obra inválido.');
      }

      const rows = await db(
        'erp_obras',
        'GET',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=*&limit=1`
      );

      if (!Array.isArray(rows) || !rows[0]) {
        throw notFoundError('Obra não encontrada.');
      }

      return res.json(rows[0]);

    } catch (error) {
      return sendRouteError(
        res,
        error,
        'carregar obra',
        'Não foi possível carregar a obra.'
      );
    }
  });

  // ============================================================
  // ATUALIZAR OBRA
  // O frontend envia PUT com o cadastro e o objeto dados completo.
  // O Supabase recebe PATCH para atualizar apenas a linha identificada.
  // ============================================================

  app.put('/api/erp/obras/:id', async (req, res) => {
    try {
      if (!validUuid(req.params.id)) {
        throw validationError('Identificador da obra inválido.');
      }

      const payload = normalizeRecord(req.body);

      const rows = await db(
        'erp_obras',
        'PATCH',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=*`,
        payload
      );

      if (!Array.isArray(rows) || !rows[0]) {
        throw notFoundError('Obra não encontrada para atualização.');
      }

      return res.json(rows[0]);

    } catch (error) {
      return sendRouteError(
        res,
        error,
        'atualizar obra',
        'Não foi possível atualizar a obra.'
      );
    }
  });

  // ============================================================
  // EXCLUIR OBRA
  // DELETE com return=representation permite devolver 404 quando não existe.
  // O cadastro do cliente e os arquivos do portal não são removidos.
  // ============================================================

  app.delete('/api/erp/obras/:id', async (req, res) => {
    try {
      if (!validUuid(req.params.id)) {
        throw validationError('Identificador da obra inválido.');
      }

      const rows = await db(
        'erp_obras',
        'DELETE',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=id`
      );

      if (!Array.isArray(rows) || !rows[0]) {
        throw notFoundError('Obra não encontrada para exclusão.');
      }

      return res.json({
        success: true
      });

    } catch (error) {
      return sendRouteError(
        res,
        error,
        'excluir obra',
        'Não foi possível excluir a obra.'
      );
    }
  });
};
