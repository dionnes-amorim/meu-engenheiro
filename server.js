const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ROTA QUE ENTREGA AS CHAVES DO RENDER PRO FRONT (sem expor no código)
app.get('/api/config', (req, res) => {
  // Log pra você ver no Render se faltou alguma variável
  if (!process.env.SUPABASE_URL) console.log('❌ FALTA SUPABASE_URL no Render');
  if (!process.env.SUPABASE_KEY) console.log('❌ FALTA SUPABASE_KEY no Render');

  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    cloudinaryName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryPreset: process.env.CLOUDINARY_PRESET
  });
});

// Health check pro Render não dormir
app.get('/health', (req, res) => res.send('OK'));

// Garante que / abre a página gerencial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Qualquer rota que não for arquivo, manda pro index (evita erro 404)
app.get('*', (req, res) => {
  const file = path.join(__dirname, 'public', req.path);
  // se for .html que existe, deixa o static resolver
  if (req.path.endsWith('.html')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ EngControl rodando na porta ${port}`);
  console.log(`→ SUPABASE_URL: ${process.env.SUPABASE_URL ? 'OK' : 'FALTANDO'}`);
  console.log(`→ CLOUDINARY: ${process.env.CLOUDINARY_CLOUD_NAME ? 'OK' : 'FALTANDO'}`);
});
