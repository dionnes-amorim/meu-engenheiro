(() => {
  const form = document.getElementById('login-form');
  const button = document.getElementById('login-btn');
  const errorBox = document.getElementById('login-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); errorBox.classList.add('hidden'); button.disabled = true; button.textContent = 'Validando acesso...';
    try {
      const email = document.getElementById('email').value.trim().toLowerCase();
      const senha = document.getElementById('senha').value;
      const query = `?email=eq.${encodeURIComponent(email)}&senha_acesso=eq.${encodeURIComponent(senha)}&select=id,nome,email,endereco_obra,progresso,status`;
      const clients = await ME.request('clientes', 'GET', null, query);
      if (!Array.isArray(clients) || !clients.length) throw new Error('E-mail ou senha não conferem. Verifique os dados e tente novamente.');
      localStorage.setItem('cliente_id', String(clients[0].id));
      window.location.href = '/painel-cliente.html';
    } catch (error) {
      errorBox.textContent = error.message || 'Não foi possível entrar. Tente novamente.'; errorBox.classList.remove('hidden');
    } finally { button.disabled = false; button.innerHTML = 'Acessar minha obra <span aria-hidden="true">→</span>'; }
  });
})();
