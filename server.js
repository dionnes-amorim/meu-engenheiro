const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Rota que o front chama pra pegar as chaves sem expor no código
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    cloudinaryName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryPreset: process.env.CLOUDINARY_PRESET
  });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log('Rodando na porta ' + port));
