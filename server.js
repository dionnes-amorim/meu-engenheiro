const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// SERVE TUDO DA PASTA PUBLIC - index.html, login-cliente.html, minha-obra.html
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_KEY,
    cloudinaryName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryPreset: process.env.CLOUDINARY_PRESET
  });
});

app.get('/health', (req,res)=> res.send('OK'));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log('Rodando na porta ' + port));
