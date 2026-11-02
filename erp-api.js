'use strict';

/*
 * PH Engenharia — API protegida do módulo ERP.
 * Integrar no server.js com:
 *   const registerErpApi = require('./erp-api');
 *   registerErpApi(app);
 * A chamada precisa ficar antes do express.static(PUBLIC_DIR).
 */

const crypto = require('node:crypto');

module.exports = function registerErpApi(app) {
  const COOKIE_NAME = 'ph_erp_admin';
  const SESSION_SECONDS = 60 * 60 * 10;
  const loginAttempts = new Map();

  function config() {
    return {
      url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    };
  }

  function sessionSecret() {
    return process.env.ERP_SESSION_SECRET || process.env.ERP_ADMIN_PASSWORD || '';
  }

  function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function signature(expiry) {
    return crypto.createHmac('sha256', sessionSecret())
      .update(String(expiry))
      .digest('base64url');
  }

  function readCookie(req, name) {
    const header = String(req.headers.cookie || '');
    const item = header.split(';').map(part => part.trim())
      .find(part => part.startsWith(`${name}=`));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
  }

  function isAuthenticated(req) {
    const token = readCookie(req, COOKIE_NAME);
    const pieces = token.split('.');
    if (pieces.length !== 2) return false;
    const expiry = Number(pieces[0]);
    if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
    if (!sessionSecret()) return false;
    return safeEqual(pieces[1], signature(expiry));
  }

  function setSessionCookie(req, res, token) {
    const secure = process.env.NODE_ENV === 'production' ||
      String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_SECONDS * 1000
    });
  }

  function clearSessionCookie(req, res) {
    const secure = process.env.NODE_ENV === 'production' ||
      String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/'
    });
  }

  function requireAdmin(req, res, next) {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: 'Sessão administrativa expirada. Entre novamente.' });
    }
    return next();
  }

  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (!origin) return next();
    try {
      if (new URL(origin).host !== req.get('host')) {
        return res.status(403).json({ error: 'Origem não autorizada.' });
      }
      return next();
    } catch {
      return res.status(403).json({ error: 'Origem inválida.' });
    }
  }

  function cleanText(value, max = 300) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function validCpf(value) {
    const cpf = String(value || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
    let digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    if (digit !== Number(cpf[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
    digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    return digit === Number(cpf[10]);
  }

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  }

  async function db(table, method = 'GET', query = '', body = null) {
    const { url, key } = config();
    if (!url || !key) {
      throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.');
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

    const response = await fetch(`${url}/rest/v1/${table}${query}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = raw; }
    }
    if (!response.ok) {
      const message = data && typeof data === 'object'
        ? data.message || data.details || data.hint
        : data;
      const error = new Error(message || `Falha no banco (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function normalizeRecord(body) {
    const b = body || {};
    const idObra = cleanText(b.id_obra, 80);
    const cpf = cleanText(b.cpf, 20).replace(/\D/g, '');
    const clienteNome = cleanText(b.cliente_nome, 160);
    const tipo = cleanText(b.tipo, 40) || 'particular';
    const dataInicio = cleanText(b.data_inicio, 10);
    const clienteId = b.cliente_id ? String(b.cliente_id) : null;

    if (!idObra || !validCpf(cpf) || !clienteNome) {
      const error = new Error('Informe ID da obra, nome do cliente e CPF válido.');
      error.status = 400;
      throw error;
    }
    if (clienteId && !validUuid(clienteId)) {
      const error = new Error('O vínculo com o cadastro do cliente é inválido.');
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
      data_inicio: /^\d{4}-\d{2}-\d{2}$/.test(dataInicio) ? dataInicio : null,
      valor_contrato: money(b.valor_contrato),
      cliente_id: clienteId,
      status: cleanText(b.status, 40) || 'Em andamento',
      dados: b.dados && typeof b.dados === 'object' && !Array.isArray(b.dados) ? b.dados : {}
    };
  }

  // Lista resumida para o seletor de obras.
  app.get('/api/erp/obras', async (_req, res) => {
    try {
      const rows = await db(
        'erp_obras',
        'GET',
        '?select=id,id_obra,cliente_nome,cpf,tipo,valor_contrato,status,updated_at&order=updated_at.desc'
      );
      res.set('Cache-Control', 'no-store');
      return res.json(rows || []);
    } catch (error) {
      console.error('[ERP obras]', error.message);
      return res.status(error.status || 500).json({ error: error.message || 'Não foi possível listar as obras.' });
    }
  });

  // Clientes cadastrados no portal; o vínculo é opcional.
  app.get('/api/erp/clientes', async (_req, res) => {
    try {
      const rows = await db(
        'clientes',
        'GET',
        '?select=id,nome,email,endereco_obra&order=nome.asc&limit=500'
      );
      res.set('Cache-Control', 'no-store');
      return res.json(rows || []);
    } catch (error) {
      console.error('[ERP clientes]', error.message);
      return res.status(error.status || 500).json({ error: 'Não foi possível carregar a lista de clientes.' });
    }
  });

  app.post('/api/erp/obras', async (req, res) => {
    try {
      const payload = normalizeRecord(req.body);
      const rows = await db('erp_obras', 'POST', '?select=*', payload);
      const record = Array.isArray(rows) ? rows[0] : rows;
      return res.status(201).json(record);
    } catch (error) {
      console.error('[ERP criar obra]', error.message);
      const duplicate = /duplicate key|unique constraint/i.test(error.message || '');
      return res.status(error.status || (duplicate ? 409 : 500)).json({
        error: duplicate ? 'Este ID de obra já está cadastrado. Gere outro identificador.' : error.message || 'Não foi possível criar a obra.'
      });
    }
  });

  app.get('/api/erp/obras/:id', async (req, res) => {
    try {
      if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Identificador da obra inválido.' });
      const rows = await db(
        'erp_obras',
        'GET',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=*`
      );
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ error: 'Obra não encontrada.' });
      res.set('Cache-Control', 'no-store');
      return res.json(rows[0]);
    } catch (error) {
      console.error('[ERP carregar obra]', error.message);
      return res.status(error.status || 500).json({ error: error.message || 'Não foi possível carregar a obra.' });
    }
  });

  app.put('/api/erp/obras/:id', async (req, res) => {
    try {
      if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Identificador da obra inválido.' });
      const payload = normalizeRecord(req.body);
      const rows = await db(
        'erp_obras',
        'PATCH',
        `?id=eq.${encodeURIComponent(req.params.id)}&select=*`,
        payload
      );
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ error: 'Obra não encontrada.' });
      return res.json(rows[0]);
    } catch (error) {
      console.error('[ERP atualizar obra]', error.message);
      const duplicate = /duplicate key|unique constraint/i.test(error.message || '');
      return res.status(error.status || (duplicate ? 409 : 500)).json({
        error: duplicate ? 'Já existe outra obra com esse ID.' : error.message || 'Não foi possível atualizar a obra.'
      });
    }
  });

  app.delete('/api/erp/obras/:id', async (req, res) => {
    try {
      if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Identificador da obra inválido.' });
      await db('erp_obras', 'DELETE', `?id=eq.${encodeURIComponent(req.params.id)}`);
      return res.json({ success: true });
    } catch (error) {
      console.error('[ERP excluir obra]', error.message);
      return res.status(error.status || 500).json({ error: error.message || 'Não foi possível excluir a obra.' });
    }
  });
};
