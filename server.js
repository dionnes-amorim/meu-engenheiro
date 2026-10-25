const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// As credenciais são lidas do ambiente configurado no Render.
// SUPABASE_KEY deve ser uma chave pública anon/publishable, nunca service_role.
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

// Alias compatível com links antigos e redirecionamentos já compartilhados.
app.get('/minha-obra.html', (_req, res) => {
  res.redirect(302, '/painel-cliente.html');
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
}));

app.listen(PORT, () => console.log(`Meu Engenheiro rodando na porta ${PORT}`));
