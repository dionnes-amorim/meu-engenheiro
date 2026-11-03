
'use strict';

/*
 * PH Engenharia — API do módulo ERP.
 *
 * Autenticação:
 * - O login é apresentado em outra página.
 * - A tela externa utiliza POST /api/erp/login.
 * - O servidor gera o cookie HttpOnly ph_erp_admin.
 * - O ERP utiliza esse mesmo cookie automaticamente.
 *
 * Integração no server.js:
 *
 * app.use(express.json({ limit: '2mb' }));
 *
 * const registerErpApi = require('./erp-api');
 * registerErpApi(app);
 *
 * app.use(express.static(PUBLIC_DIR));
 *
 * IMPORTANTE:
 * Registrar depois do express.json() e antes do express.static().
 */

const crypto = require('node:crypto');

module.exports = function registerErpApi(app) {

  const COOKIE_NAME = 'ph_erp_admin';
  const SESSION_SECONDS = 60 * 60 * 10;
  const loginAttempts = new Map();

  // ======================================================
  // CONFIGURAÇÕES
  // ======================================================

  function config() {
    return {
      url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    };
  }

  function sessionSecret() {
    return process.env.ERP_SESSION_SECRET ||
      process.env.ERP_ADMIN_PASSWORD ||
      '';
  }

  function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));

    return a.length === b.length &&
      crypto.timingSafeEqual(a, b);
  }

  function signature(expiry) {
    return crypto
      .createHmac('sha256', sessionSecret())
      .update(String(expiry))
      .digest('base64url');
  }

  // ======================================================
  // CONTROLE DE SESSÃO
  // ======================================================

  function readCookie(req, name) {
    const header = String(req.headers.cookie || '');

    const item = header
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(`${name}=`));

    if (!item) return '';

    try {
      return decodeURIComponent(
        item.slice(name.length + 1)
      );
    } catch {
      return '';
    }
  }

  function isAuthenticated(req) {
    const token = readCookie(req, COOKIE_NAME);

    if (!token) return false;

    const pieces = token.split('.');

    if (pieces.length !== 2) return false;

    const expiry = Number(pieces[0]);

    if (
      !Number.isFinite(expiry) ||
      expiry <= Math.floor(Date.now() / 1000)
    ) {
      return false;
    }

    if (!sessionSecret()) return false;

    return safeEqual(
      pieces[1],
      signature(expiry)
    );
  }

  function cookieOptions(req) {
    const forwardedProto = String(
      req.headers['x-forwarded-proto'] || ''
    )
      .split(',')[0]
      .trim();

    const secure =
      process.env.NODE_ENV === 'production' ||
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
    res.cookie(
      COOKIE_NAME,
      token,
      cookieOptions(req)
    );
  }

  function clearSessionCookie(req, res) {
    res.clearCookie(
      COOKIE_NAME,
      cookieOptions(req)
    );
  }

  // ======================================================
  // SEGURANÇA DAS ROTAS
  // ======================================================

  function requireAdmin(req, res, next) {
    if (!isAuthenticated(req)) {
      return res.status(401).json({
        error: 'Sessão administrativa não reconhecida. Entre pela tela de acesso.'
      });
    }

    next();
  }

  function sameOrigin(req, res, next) {
    const origin = req.get('origin');

    if (!origin) return next();

    try {
      const requestOrigin = new URL(origin);

      if (requestOrigin.host !== req.get('host')) {
        return res.status(403).json({
          error: 'Origem não autorizada.'
        });
      }

      next();

    } catch {
      return res.status(403).json({
        error: 'Origem inválida.'
      });
    }
  }

  function noStore(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }

  // ======================================================
  // UTILITÁRIOS
  // ======================================================

  function cleanText(value, max = 300) {
    return typeof value === 'string'
      ? value.trim().slice(0, max)
      : '';
  }

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value || ''));
  }

  function validCpf(value) {
    const cpf = String(value || '').replace(/\D/g, '');

    if (
      cpf.length !== 11 ||
      /^(\d)\1{10}$/.test(cpf)
    ) {
      return false;
    }

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
    const n = Number(value);

    return Number.isFinite(n) && n >= 0
      ? Math.round(n * 100) / 100
      : 0;
  }

  // ======================================================
  // CONEXÃO COM SUPABASE
  // ======================================================

  async function db(table, method = 'GET', query = '', body = null) {

    const { url, key } = config();

    if (!url || !key) {
      throw new Error(
        'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.'
      );
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

    const response = await fetch(
      `${url}/rest/v1/${table}${query}`,
      {
        method,
        headers,
        body: body === null
          ? undefined
          : JSON.stringify(body)
      }
    );

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

      const message =
        data && typeof data === 'object'
          ? data.message || data.details || data.hint
          : data;

      const error = new Error(
        message || `Falha no Supabase (${response.status}).`
      );

      error.status = response.status;

      throw error;
    }

    return data;
  }

  // ======================================================
  // VALIDAÇÃO E NORMALIZAÇÃO DAS OBRAS
  // ======================================================

  function normalizeRecord(body) {

    const b = body || {};

    const idObra = cleanText(b.id_obra, 80);
    const cpf = cleanText(b.cpf, 20).replace(/\D/g, '');
    const clienteNome = cleanText(b.cliente_nome, 160);
    const tipo = cleanText(b.tipo, 40) || 'particular';
    const dataInicio = cleanText(b.data_inicio, 10);

    const clienteId = b.cliente_id
      ? String(b.cliente_id)
      : null;

    if (!idObra || !validCpf(cpf) || !clienteNome) {
      const error = new Error(
        'Informe ID da obra, nome do cliente e CPF válido.'
      );

      error.status = 400;

      throw error;
    }

    if (clienteId && !validUuid(clienteId)) {
      const error = new Error(
        'O vínculo com o cadastro do cliente é inválido.'
      );

      error.status = 400;

      throw error;
    }

    return {
      id_obra: idObra,
      cpf,
      cliente_nome: clienteNome,
      telefone: cleanText(b.telefone, 40) || null,
      endereco: cleanText(b.endereco, 350) || null,
      tipo,

      data_inicio: /^\d{4}-\d{2}-\d{2}$/.test(dataInicio)
        ? dataInicio
        : null,

      valor_contrato: money(b.valor_contrato),
      cliente_id: clienteId,
      status: cleanText(b.status, 40) || 'Em andamento',

      dados:
        b.dados &&
        typeof b.dados === 'object' &&
        !Array.isArray(b.dados)
          ? b.dados
          : {}
    };
  }

  // ======================================================
  // AUTENTICAÇÃO DA TELA EXTERNA
  // ======================================================

  /*
   * Esta rota permanece no servidor.
   * Não existe formulário de login no HTML do ERP.
   *
   * A outra tela deve chamar:
   *
   * POST /api/erp/login
   *
   * {
   *   "password": "SENHA_ADMINISTRATIVA"
   * }
   *
   * O servidor devolve um cookie HttpOnly automaticamente.
   */

  app.get('/api/erp/session', (req, res) => {

    noStore(res);

    res.json({
      authenticated: isAuthenticated(req),

      configured: Boolean(
        process.env.ERP_ADMIN_PASSWORD &&
        sessionSecret() &&
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    });
  });

  app.post('/api/erp/login', sameOrigin, (req, res) => {

    noStore(res);

    const configuredPassword =
      process.env.ERP_ADMIN_PASSWORD;

    if (
      !configuredPassword ||
      !process.env.SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return res.status(503).json({
        error: 'Configure ERP_ADMIN_PASSWORD, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.'
      });
    }

    const ip = String(
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown'
    );

    const now = Date.now();

    const record = loginAttempts.get(ip) || {
      count: 0,
      resetAt: now + 15 * 60 * 1000
    };

    if (record.resetAt < now) {
      record.count = 0;
      record.resetAt = now + 15 * 60 * 1000;
    }

    if (record.count >= 8) {
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'
      });
    }

    const password = String(req.body?.password || '');

    if (!safeEqual(password, configuredPassword)) {

      record.count += 1;

      loginAttempts.set(ip, record);

      return res.status(401).json({
        error: 'Senha administrativa incorreta.'
      });
    }

    loginAttempts.delete(ip);

    const expiry =
      Math.floor(Date.now() / 1000) + SESSION_SECONDS;

    const token = `${expiry}.${signature(expiry)}`;

    setSessionCookie(req, res, token);

    return res.json({
      success: true,
      expires_in: SESSION_SECONDS
    });
  });

  app.post('/api/erp/logout', sameOrigin, (req, res) => {

    noStore(res);

    clearSessionCookie(req, res);

    return res.json({
      success: true
    });
  });

  // ======================================================
  // PROTEÇÃO DE TODAS AS ROTAS INTERNAS DO ERP
  // ======================================================

  /*
   * As três rotas públicas de autenticação acima ficam fora
   * deste middleware.
   *
   * Todas as demais rotas /api/erp exigem sessão válida.
   */

  app.use(
    '/api/erp',
    sameOrigin,
    requireAdmin
  );

  // ======================================================
  // LISTAGEM DE OBRAS
  // ======================================================

  app.get('/api/erp/obras', async (_req, res) => {

    try {

      const rows = await db(
        'erp_obras',
        'GET',
        '?select=id,id_obra,cliente_nome,cpf,tipo,valor_contrato,status,updated_at&order=updated_at.desc'
      );

      noStore(res);

      return res.json(rows || []);

    } catch (error) {

      console.error('[ERP obras]', error.message);

      return res.status(error.status || 500).json({
        error: error.message || 'Não foi possível listar as obras.'
      });
    }
  });

  // ======================================================
  // CLIENTES DO PORTAL
  // ======================================================

  app.get('/api/erp/clientes', async (_req, res) => {

    try {

      const rows = await db(
        'clientes',
        'GET',
        '?select=id,nome,email,endereco_obra&order=nome.asc&limit=500'
      );

      noStore(res);

      return res.json(rows || []);

    } catch (error) {

      console.error('[ERP clientes]', error.message);

      return res.status(error.status || 500).json({
        error: error.message || 'Não foi possível carregar a lista de clientes.'
      });
    }
  });

  // ======================================================
  // CRIAR OBRA
  // ======================================================

  app.post('/api/erp/obras', async (req, res) => {

    try {

      const payload = normalizeRecord(req.body);

      const rows = await db(
        'erp_obras',
        'POST',
        '?select=*',
        payload
      );

      const record = Array.isArray(rows)
        ? rows[0]
        : rows;

      return res.status(201).json(record);

    } catch (error) {

      console.error('[ERP criar obra]', error.message);

      const duplicate =
        /duplicate key|unique constraint/i.test(error.message || '');

      return res.status(
        error.status || (duplicate ? 409 : 500)
      ).json({
        error: duplicate
          ? 'Este ID de obra já está cadastrado. Gere outro identificador.'
          : error.message || 'Não foi possível criar a obra.'
      });
    }
  });

  // ======================================================
  // CONSULTAR UMA OBRA
  // ======================================================

  app.get('/api/erp/obras/:id', async (req, res) => {

    try {

      if (!validUuid(req.params.id)) {
        return res.status(400).json({
          error: 'Identificador da obra inválido.'
        });
      }

      const rows = await db(
        'erp_obras',
        'GET',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=*`
      );

      if (!Array.isArray(rows) || !rows[0]) {
        return res.status(404).json({
          error: 'Obra não encontrada.'
        });
      }

      noStore(res);

      return res.json(rows[0]);

    } catch (error) {

      console.error('[ERP carregar obra]', error.message);

      return res.status(error.status || 500).json({
        error: error.message || 'Não foi possível carregar a obra.'
      });
    }
  });

  // ======================================================
  // ATUALIZAR OBRA
  // ======================================================

  app.put('/api/erp/obras/:id', async (req, res) => {

    try {

      if (!validUuid(req.params.id)) {
        return res.status(400).json({
          error: 'Identificador da obra inválido.'
        });
      }

      const payload = normalizeRecord(req.body);

      const rows = await db(
        'erp_obras',
        'PATCH',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=*`,
        payload
      );

      if (!Array.isArray(rows) || !rows[0]) {
        return res.status(404).json({
          error: 'Obra não encontrada.'
        });
      }

      return res.json(rows[0]);

    } catch (error) {

      console.error('[ERP atualizar obra]', error.message);

      const duplicate =
        /duplicate key|unique constraint/i.test(error.message || '');

      return res.status(
        error.status || (duplicate ? 409 : 500)
      ).json({
        error: duplicate
          ? 'Já existe outra obra com esse ID.'
          : error.message || 'Não foi possível atualizar a obra.'
      });
    }
  });

  // ======================================================
  // EXCLUIR OBRA
  // ======================================================

  app.delete('/api/erp/obras/:id', async (req, res) => {

    try {

      if (!validUuid(req.params.id)) {
        return res.status(400).json({
          error: 'Identificador da obra inválido.'
        });
      }

      await db(
        'erp_obras',
        'DELETE',
        `?id=eq.${encodeURIComponent(req.params.id)}`
      );

      return res.json({
        success: true
      });

    } catch (error) {

      console.error('[ERP excluir obra]', error.message);

      return res.status(error.status || 500).json({
        error: error.message || 'Não foi possível excluir a obra.'
      });
    }
  });

};
