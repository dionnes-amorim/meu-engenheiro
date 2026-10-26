
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// --------------------------------------------------
// CONFIGURAÇÕES E UTILITÁRIOS
// --------------------------------------------------

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_KEY || '',
    cloudinaryName: process.env.CLOUDINARY_CLOUD_NAME || '',
    cloudinaryPreset: process.env.CLOUDINARY_PRESET || ''
  });
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/minha-obra.html', (_req, res) => {
  res.redirect(302, '/painel-cliente.html');
});

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

function cleanText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function isCloudinaryUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'res.cloudinary.com'
    );
  } catch {
    return false;
  }
}

function handleError(res, error, publicMessage) {
  console.error('[API]', error?.message || error);

  res.status(500).json({
    error: publicMessage
  });
}

// --------------------------------------------------
// SUPABASE — ACESSO EXCLUSIVO PELO SERVIDOR
// --------------------------------------------------

async function supabaseRequest(table, method, query = '', body = null) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.'
    );
  }

  const baseUrl = supabaseUrl.replace(/\/+$/, '');

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json'
  };

  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }

  const response = await fetch(
    `${baseUrl}/rest/v1/${table}${query}`,
    {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body)
    }
  );

  const responseText = await response.text();
  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object'
        ? data.message || data.details || data.hint
        : null;

    throw new Error(
      message || `Erro no Supabase: HTTP ${response.status}.`
    );
  }

  return data;
}

// --------------------------------------------------
// ARQUIVOS — LISTAGEM
// --------------------------------------------------

app.get('/api/arquivos', async (req, res) => {
  try {
    const clienteId = String(req.query.cliente_id || '');

    if (!validId(clienteId)) {
      return res.status(400).json({
        error: 'ID do cliente inválido.'
      });
    }

    const files = await supabaseRequest(
      'arquivos',
      'GET',
      `?cliente_id=eq.${encodeURIComponent(clienteId)}` +
      '&select=id,cliente_id,nome,url,public_id,created_at,categoria,etapa,descricao' +
      '&order=created_at.desc'
    );

    res.set('Cache-Control', 'no-store');
    return res.json(files || []);
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível listar os arquivos. Verifique a configuração do banco e as colunas da tabela arquivos.'
    );
  }
});

// --------------------------------------------------
// ARQUIVOS — CADASTRO
// Requer as colunas categoria, etapa e descricao
// da migração SQL antes de usar esses novos campos.
// --------------------------------------------------

app.post('/api/arquivos', async (req, res) => {
  try {
    const body = req.body || {};

    const clienteId = String(body.cliente_id || '');
    const nome = cleanText(body.nome, 200);
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const publicId = cleanText(body.public_id, 500);
    const categoria = cleanText(body.categoria, 40) || 'Documento';
    const etapa = cleanText(body.etapa, 100);
    const descricao = cleanText(body.descricao, 1000);

    if (!validId(clienteId)) {
      return res.status(400).json({
        error: 'ID do cliente inválido.'
      });
    }

    if (!nome || !isCloudinaryUrl(url)) {
      return res.status(400).json({
        error: 'Informe um nome válido e uma URL segura do Cloudinary.'
      });
    }

    if (!['Documento', 'Foto da obra'].includes(categoria)) {
      return res.status(400).json({
        error: 'Categoria inválida. Use Documento ou Foto da obra.'
      });
    }

    const rows = await supabaseRequest(
      'arquivos',
      'POST',
      '?select=id,cliente_id,nome,url,public_id,created_at,categoria,etapa,descricao',
      {
        cliente_id: clienteId,
        nome,
        url,
        public_id: publicId || null,
        categoria,
        etapa: etapa || null,
        descricao: descricao || null
      }
    );

    return res.status(201).json(
      Array.isArray(rows) ? rows[0] : rows
    );
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível registrar o arquivo. Confirme se a migração SQL foi executada.'
    );
  }
});

// --------------------------------------------------
// ARQUIVOS — RENOMEAR E EDITAR METADADOS
// --------------------------------------------------

app.patch('/api/arquivos', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const body = req.body || {};

    if (!validId(id)) {
      return res.status(400).json({
        error: 'ID do arquivo inválido.'
      });
    }

    const updates = {};

    if (body.nome !== undefined) {
      const nome = cleanText(body.nome, 200);

      if (!nome) {
        return res.status(400).json({
          error: 'O nome do arquivo não pode ficar vazio.'
        });
      }

      updates.nome = nome;
    }

    if (body.categoria !== undefined) {
      const categoria = cleanText(body.categoria, 40);

      if (!['Documento', 'Foto da obra'].includes(categoria)) {
        return res.status(400).json({
          error: 'Categoria inválida.'
        });
      }

      updates.categoria = categoria;
    }

    if (body.etapa !== undefined) {
      updates.etapa = cleanText(body.etapa, 100) || null;
    }

    if (body.descricao !== undefined) {
      updates.descricao = cleanText(body.descricao, 1000) || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'Nenhum campo válido foi enviado para atualização.'
      });
    }

    const rows = await supabaseRequest(
      'arquivos',
      'PATCH',
      `?id=eq.${encodeURIComponent(id)}` +
      '&select=id,cliente_id,nome,url,public_id,created_at,categoria,etapa,descricao',
      updates
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({
        error: 'Arquivo não encontrado.'
      });
    }

    return res.json(rows[0]);
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível atualizar os dados do arquivo.'
    );
  }
});

// --------------------------------------------------
// CLOUDINARY — EXCLUIR MÍDIA
// --------------------------------------------------

async function deleteCloudinaryFile(file) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  // Sem todas as credenciais, não é possível excluir a mídia.
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Credenciais de exclusão do Cloudinary não configuradas.'
    );
  }

  if (!file.public_id) {
    throw new Error(
      'O arquivo não possui public_id para exclusão no Cloudinary.'
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);

  const signatureBase =
    `public_id=${file.public_id}&timestamp=${timestamp}`;

  const signature = crypto
    .createHash('sha1')
    .update(signatureBase + apiSecret)
    .digest('hex');

  let resourceType = 'image';

  if (typeof file.url === 'string') {
    if (file.url.includes('/raw/upload/')) {
      resourceType = 'raw';
    } else if (file.url.includes('/video/upload/')) {
      resourceType = 'video';
    }
  }

  const form = new URLSearchParams({
    public_id: file.public_id,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    }
  );

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      'Resposta inválida recebida do Cloudinary.'
    );
  }

  if (!response.ok) {
    throw new Error(
      result?.error?.message ||
      'O Cloudinary não conseguiu excluir o arquivo.'
    );
  }

  if (!['ok', 'not found'].includes(result?.result)) {
    throw new Error(
      'O Cloudinary não confirmou a exclusão do arquivo.'
    );
  }

  return result;
}

// --------------------------------------------------
// ARQUIVOS — EXCLUIR
// Primeiro remove a mídia; depois o registro no banco.
// --------------------------------------------------

app.delete('/api/arquivos', async (req, res) => {
  try {
    const id = String(req.query.id || '');

    if (!validId(id)) {
      return res.status(400).json({
        error: 'ID do arquivo inválido.'
      });
    }

    const rows = await supabaseRequest(
      'arquivos',
      'GET',
      `?id=eq.${encodeURIComponent(id)}` +
      '&select=id,cliente_id,public_id,url'
    );

    const file = Array.isArray(rows) ? rows[0] : null;

    if (!file) {
      return res.status(404).json({
        error: 'Arquivo não encontrado.'
      });
    }

    // Se o Cloudinary falhar, o registro do banco será preservado.
    await deleteCloudinaryFile(file);

    await supabaseRequest(
      'arquivos',
      'DELETE',
      `?id=eq.${encodeURIComponent(id)}`
    );

    return res.json({
      success: true,
      message: 'Arquivo removido da obra.'
    });
  } catch (error) {
    return handleError(
      res,
      error,
      error?.message || 'Não foi possível excluir o arquivo.'
    );
  }
});

// --------------------------------------------------
// ETAPAS DA OBRA
// Requer a tabela etapas_obra criada pela migração.
// --------------------------------------------------

app.get('/api/etapas', async (req, res) => {
  try {
    const clienteId = String(req.query.cliente_id || '');

    if (!validId(clienteId)) {
      return res.status(400).json({
        error: 'ID do cliente inválido.'
      });
    }

    const rows = await supabaseRequest(
      'etapas_obra',
      'GET',
      `?cliente_id=eq.${encodeURIComponent(clienteId)}` +
      '&select=*&order=ordem.asc'
    );

    res.set('Cache-Control', 'no-store');
    return res.json(rows || []);
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível carregar as etapas. Verifique se a tabela etapas_obra existe.'
    );
  }
});

app.post('/api/etapas', async (req, res) => {
  try {
    const body = req.body || {};
    const clienteId = String(body.cliente_id || '');
    const nome = cleanText(body.nome, 150);
    const ordem = Number(body.ordem);

    if (
      !validId(clienteId) ||
      !nome ||
      !Number.isInteger(ordem) ||
      ordem < 0
    ) {
      return res.status(400).json({
        error: 'Informe cliente, nome da etapa e ordem válida.'
      });
    }

    const status = cleanText(body.status, 40) || 'Pendente';

    if (!['Pendente', 'Em andamento', 'Concluída'].includes(status)) {
      return res.status(400).json({
        error: 'Status da etapa inválido.'
      });
    }

    const rows = await supabaseRequest(
      'etapas_obra',
      'POST',
      '?select=*',
      {
        cliente_id: clienteId,
        nome,
        ordem,
        status
      }
    );

    return res.status(201).json(
      Array.isArray(rows) ? rows[0] : rows
    );
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível cadastrar a etapa da obra.'
    );
  }
});

// --------------------------------------------------
// HISTÓRICO E ATUALIZAÇÕES DA OBRA
// Requer a tabela atualizacoes_obra criada pela migração.
// --------------------------------------------------

app.get('/api/atualizacoes', async (req, res) => {
  try {
    const clienteId = String(req.query.cliente_id || '');

    if (!validId(clienteId)) {
      return res.status(400).json({
        error: 'ID do cliente inválido.'
      });
    }

    const rows = await supabaseRequest(
      'atualizacoes_obra',
      'GET',
      `?cliente_id=eq.${encodeURIComponent(clienteId)}` +
      '&select=*&order=created_at.desc'
    );

    res.set('Cache-Control', 'no-store');
    return res.json(rows || []);
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível carregar o histórico da obra.'
    );
  }
});

app.post('/api/atualizacoes', async (req, res) => {
  try {
    const body = req.body || {};
    const clienteId = String(body.cliente_id || '');
    const titulo = cleanText(body.titulo, 200);
    const descricao = cleanText(body.descricao, 2000);

    if (!validId(clienteId) || !titulo || !descricao) {
      return res.status(400).json({
        error: 'Informe o cliente, o título e a descrição da atualização.'
      });
    }

    const rows = await supabaseRequest(
      'atualizacoes_obra',
      'POST',
      '?select=*',
      {
        cliente_id: clienteId,
        titulo,
        descricao
      }
    );

    return res.status(201).json(
      Array.isArray(rows) ? rows[0] : rows
    );
  } catch (error) {
    return handleError(
      res,
      error,
      'Não foi possível salvar a atualização da obra.'
    );
  }
});

// --------------------------------------------------
// ARQUIVOS ESTÁTICOS
// --------------------------------------------------

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
}));

app.listen(PORT, () => {
  console.log(`Meu Engenheiro rodando na porta ${PORT}`);
});
