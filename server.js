
const express = require('express');
const path = require('path');

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

// Acesso ao Supabase somente pelo servidor.
async function supabaseRequest(table, method, query = '', body = null) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Configuração segura do Supabase ausente no servidor.');
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

  if (!response.ok) {
    throw new Error(`Supabase: ${text || response.status}`);
  }

  return text ? JSON.parse(text) : null;
}

// Lista arquivos de uma obra.
app.get('/api/arquivos', async (req, res) => {
  try {
    const clienteId = String(req.query.cliente_id || '');

    if (!/^[0-9a-f-]{36}$/i.test(clienteId)) {
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

// Registra o link do arquivo já enviado ao Cloudinary.
app.post('/api/arquivos', async (req, res) => {
  try {
    const { cliente_id, nome, url, public_id } = req.body || {};

    if (
      !/^[0-9a-f-]{36}$/i.test(String(cliente_id || '')) ||
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
    res.status(500).json({ error: 'O arquivo foi enviado, mas não foi possível registrar seus dados.' });
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
