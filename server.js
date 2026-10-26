
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_KEY || '',
    cloudinaryName: process.env.CLOUDINARY_CLOUD_NAME || '',
    cloudinaryPreset: process.env.CLOUDINARY_PRESET || ''
  });
});

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.get('/minha-obra.html', (_req, res) => {
  res.redirect(302, '/painel-cliente.html');
});

async function supabaseRequest(table, method, query = '', body = null) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Configuração do Supabase ausente no servidor.');
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
    `${url.replace(/\/$/, '')}/rest/v1/${table}${query}`,
    {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body)
    }
  );

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof data === 'object' && data
        ? data.message || data.details || data.hint || 'Erro no Supabase.'
        : String(data || `Erro ${response.status} no Supabase.`)
    );
  }

  return data;
}

function validId(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ''));
}

// Lista os arquivos de um cliente.
app.get('/api/arquivos', async (req, res) => {
  try {
    const clienteId = String(req.query.cliente_id || '');

    if (!validId(clienteId)) {
      return res.status(400).json({ error: 'ID do cliente inválido.' });
    }

    const files = await supabaseRequest(
      'arquivos',
      'GET',
      `?cliente_id=eq.${encodeURIComponent(clienteId)}&select=id,cliente_id,nome,url,public_id,created_at&order=created_at.desc`
    );

    res.set('Cache-Control', 'no-store');
    res.json(files);
  } catch (error) {
    console.error('Erro ao listar arquivos:', error.message);
    res.status(500).json({ error: 'Não foi possível listar os arquivos.' });
  }
});

// Registra os metadados de um arquivo enviado ao Cloudinary.
app.post('/api/arquivos', async (req, res) => {
  try {
    const { cliente_id, nome, url, public_id } = req.body || {};

    if (
      !validId(cliente_id) ||
      typeof nome !== 'string' ||
      !nome.trim() ||
      typeof url !== 'string' ||
      !url.startsWith('https://res.cloudinary.com/')
    ) {
      return res.status(400).json({ error: 'Dados do arquivo inválidos.' });
    }

    const rows = await supabaseRequest('arquivos', 'POST', '', {
      cliente_id,
      nome: nome.trim(),
      url,
      public_id: typeof public_id === 'string' ? public_id : null
    });

    res.status(201).json(Array.isArray(rows) ? rows[0] : rows);
  } catch (error) {
    console.error('Erro ao salvar arquivo:', error.message);
    res.status(500).json({
      error: 'O arquivo foi enviado, mas não foi possível registrar seus dados.'
    });
  }
});

// Renomeia um arquivo sem alterar seu endereço.
app.patch('/api/arquivos', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    const nome = req.body?.nome;

    if (!validId(id) || typeof nome !== 'string' || !nome.trim()) {
      return res.status(400).json({ error: 'ID ou nome do arquivo inválido.' });
    }

    const rows = await supabaseRequest(
      'arquivos',
      'PATCH',
      `?id=eq.${encodeURIComponent(id)}&select=id,cliente_id,nome,url,public_id,created_at`,
      { nome: nome.trim() }
    );

    if (!rows?.length) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Erro ao renomear arquivo:', error.message);
    res.status(500).json({ error: 'Não foi possível renomear o arquivo.' });
  }
});

// Exclui o registro e, quando configurado, também o arquivo no Cloudinary.
app.delete('/api/arquivos', async (req, res) => {
  try {
    const id = String(req.query.id || '');

    if (!validId(id)) {
      return res.status(400).json({ error: 'ID do arquivo inválido.' });
    }

    const rows = await supabaseRequest(
      'arquivos',
      'GET',
      `?id=eq.${encodeURIComponent(id)}&select=id,public_id,url`
    );

    const file = rows?.[0];

    if (!file) {
      return res.status(404).json({ error: 'Arquivo não encontrado.' });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    // Se as credenciais estiverem configuradas, remove também a mídia.
    if (file.public_id && cloudName && apiKey && apiSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureBase = `public_id=${file.public_id}&timestamp=${timestamp}`;
      const signature = crypto
        .createHash('sha1')
        .update(signatureBase + apiSecret)
        .digest('hex');

      let resourceType = 'image';

      if (file.url.includes('/raw/upload/')) resourceType = 'raw';
      else if (file.url.includes('/video/upload/')) resourceType = 'video';

      const form = new URLSearchParams({
        public_id: file.public_id,
        timestamp: String(timestamp),
        api_key: apiKey,
        signature
      });

      const cloudResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/destroy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form
        }
      );

      const cloudResult = await cloudResponse.json();

      if (!cloudResponse.ok || !['ok', 'not found'].includes(cloudResult.result)) {
        throw new Error('O Cloudinary não confirmou a exclusão do arquivo.');
      }
    }

    await supabaseRequest(
      'arquivos',
      'DELETE',
      `?id=eq.${encodeURIComponent(id)}`
    );

    res.json({
      success: true,
      message: 'Arquivo removido da obra.'
    });
  } catch (error) {
    console.error('Erro ao excluir arquivo:', error.message);
    res.status(500).json({ error: error.message || 'Não foi possível excluir o arquivo.' });
  }
});

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
