
(function () {
  let configPromise;

  async function getConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/config', { cache: 'no-store' })
        .then(async response => {
          if (!response.ok) {
            throw new Error('Não foi possível carregar as configurações.');
          }

          const config = await response.json();

          if (!config.supabaseUrl || !config.supabaseKey) {
            throw new Error('Configure SUPABASE_URL e SUPABASE_KEY no Render.');
          }

          return config;
        })
        .catch(error => {
          configPromise = null;
          throw error;
        });
    }

    return configPromise;
  }

  async function request(table, method = 'GET', body = null, query = '') {
    if (table === 'arquivos') {
      const params = new URLSearchParams(
        query.startsWith('?') ? query.slice(1) : query
      );

      let endpoint = '/api/arquivos';

      if (method === 'GET') {
        const rawId = params.get('cliente_id') || '';
        const clienteId = rawId.startsWith('eq.')
          ? rawId.slice(3)
          : rawId;

        if (!clienteId) {
          throw new Error('Não foi informado o cliente da obra.');
        }

        endpoint += `?cliente_id=${encodeURIComponent(clienteId)}`;
      } else if (method === 'PATCH' || method === 'DELETE') {
        const rawId = params.get('id') || '';
        const id = rawId.startsWith('eq.') ? rawId.slice(3) : rawId;

        if (!id) {
          throw new Error('Não foi informado o arquivo.');
        }

        endpoint += `?id=${encodeURIComponent(id)}`;
      }

      const headers = { Accept: 'application/json' };

      if (body !== null) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(endpoint, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body)
      });

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
        const message = data && typeof data === 'object'
          ? data.error || data.message || data.details || data.hint
          : data;

        throw new Error(
          message || `Falha ao acessar arquivos (${response.status}).`
        );
      }

      return data;
    }

    const config = await getConfig();

    const headers = {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
      Accept: 'application/json'
    };

    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = 'return=representation';
    }

    const response = await fetch(
      `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}${query}`,
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
      const message = data && typeof data === 'object'
        ? data.message || data.details || data.hint
        : data;

      throw new Error(
        message || `Falha ao acessar ${table} (${response.status}).`
      );
    }

    return data;
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0] || '')
      .join('')
      .toUpperCase() || '?';
  }

  function date(value) {
    if (!value) return 'Data não informada';

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime())
      ? 'Data não informada'
      : parsed.toLocaleDateString('pt-BR');
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);

      return ['https:', 'http:'].includes(url.protocol)
        ? url.href
        : '#';
    } catch {
      return '#';
    }
  }

  function toast(message, type = '') {
    const old = document.querySelector('.toast');
    if (old) old.remove();

    const node = document.createElement('div');
    node.className = `toast ${type}`.trim();
    node.textContent = message;

    document.body.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  window.ME = {
    getConfig,
    request,
    escape,
    initials,
    date,
    safeUrl,
    toast
  };
})();
