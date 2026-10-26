
(function () {
  let configPromise;

  // --------------------------------------------------
  // CONFIGURAÇÕES
  // --------------------------------------------------

  async function getConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/config', {
        cache: 'no-store'
      })
        .then(async response => {
          if (!response.ok) {
            throw new Error(
              'Não foi possível carregar as configurações do sistema.'
            );
          }

          const config = await response.json();

          if (!config.supabaseUrl || !config.supabaseKey) {
            throw new Error(
              'Configure SUPABASE_URL e SUPABASE_KEY no Render.'
            );
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

  // --------------------------------------------------
  // TRATAMENTO DAS RESPOSTAS
  // --------------------------------------------------

  async function parseResponse(response, context) {
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
      const message =
        data && typeof data === 'object'
          ? data.error ||
            data.message ||
            data.details ||
            data.hint
          : data;

      throw new Error(
        message || `Falha ao acessar ${context} (${response.status}).`
      );
    }

    return data;
  }

  function normalizeQuery(query) {
    return new URLSearchParams(
      String(query || '').replace(/^\?/, '')
    );
  }

  function extractId(params, field) {
    const value = params.get(field) || '';

    return value.startsWith('eq.')
      ? value.slice(3)
      : value;
  }

  // --------------------------------------------------
  // ROTAS DO SERVIDOR
  // Arquivos, etapas e atualizações da obra
  // --------------------------------------------------

  async function serverRequest(table, method, body, query) {
    const params = normalizeQuery(query);

    let endpoint;
    let context = table;

    if (table === 'arquivos') {
      endpoint = '/api/arquivos';

      if (method === 'GET') {
        const clienteId = extractId(params, 'cliente_id');

        if (!clienteId) {
          throw new Error(
            'Não foi informado o cliente da obra.'
          );
        }

        endpoint += `?cliente_id=${encodeURIComponent(clienteId)}`;
      } else if (
        method === 'PATCH' ||
        method === 'DELETE'
      ) {
        const id = extractId(params, 'id');

        if (!id) {
          throw new Error(
            'Não foi informado o identificador do arquivo.'
          );
        }

        endpoint += `?id=${encodeURIComponent(id)}`;
      } else if (method !== 'POST') {
        throw new Error(
          `Operação ${method} não disponível para arquivos.`
        );
      }
    } else if (
      table === 'etapas_obra' ||
      table === 'etapas'
    ) {
      endpoint = '/api/etapas';
      context = 'etapas da obra';

      if (method === 'GET') {
        const clienteId = extractId(params, 'cliente_id');

        if (!clienteId) {
          throw new Error(
            'Não foi informado o cliente para carregar as etapas.'
          );
        }

        endpoint += `?cliente_id=${encodeURIComponent(clienteId)}`;
      } else if (method !== 'POST') {
        throw new Error(
          'Esta rota permite listar e cadastrar etapas. A edição e a exclusão precisam de rotas próprias.'
        );
      }
    } else if (
      table === 'atualizacoes_obra' ||
      table === 'atualizacoes'
    ) {
      endpoint = '/api/atualizacoes';
      context = 'histórico da obra';

      if (method === 'GET') {
        const clienteId = extractId(params, 'cliente_id');

        if (!clienteId) {
          throw new Error(
            'Não foi informado o cliente para carregar o histórico.'
          );
        }

        endpoint += `?cliente_id=${encodeURIComponent(clienteId)}`;
      } else if (method !== 'POST') {
        throw new Error(
          'Esta rota permite listar e cadastrar atualizações.'
        );
      }
    } else {
      throw new Error(
        `A tabela ${table} não possui uma rota de servidor configurada.`
      );
    }

    const headers = {
      Accept: 'application/json'
    };

    if (body !== null && body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(endpoint, {
      method,
      headers,
      body:
        body === null || body === undefined
          ? undefined
          : JSON.stringify(body),
      cache: 'no-store'
    });

    return parseResponse(response, context);
  }

  // --------------------------------------------------
  // SUPABASE — TABELAS EXISTENTES
  // --------------------------------------------------

  async function supabaseRequest(
    table,
    method = 'GET',
    body = null,
    query = ''
  ) {
    const config = await getConfig();

    const headers = {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
      Accept: 'application/json'
    };

    if (body !== null && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = 'return=representation';
    }

    const response = await fetch(
      `${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}${query}`,
      {
        method,
        headers,
        body:
          body === null || body === undefined
            ? undefined
            : JSON.stringify(body),
        cache: 'no-store'
      }
    );

    return parseResponse(response, table);
  }

  // --------------------------------------------------
  // FUNÇÃO PRINCIPAL DE ACESSO AOS DADOS
  // Mantém a assinatura usada pelos outros arquivos.
  // --------------------------------------------------

  async function request(
    table,
    method = 'GET',
    body = null,
    query = ''
  ) {
    const normalizedMethod = String(method || 'GET').toUpperCase();

    const serverTables = [
      'arquivos',
      'etapas_obra',
      'etapas',
      'atualizacoes_obra',
      'atualizacoes'
    ];

    if (serverTables.includes(table)) {
      return serverRequest(
        table,
        normalizedMethod,
        body,
        query
      );
    }

    return supabaseRequest(
      table,
      normalizedMethod,
      body,
      query
    );
  }

  // --------------------------------------------------
  // SEGURANÇA DE TEXTO PARA HTML
  // --------------------------------------------------

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  // --------------------------------------------------
  // INICIAIS PARA AVATARES
  // --------------------------------------------------

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0] || '')
      .join('')
      .toUpperCase() || '?';
  }

  // --------------------------------------------------
  // FORMATAÇÃO DE DATAS
  // --------------------------------------------------

  function date(value) {
    if (!value) {
      return 'Data não informada';
    }

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime())
      ? 'Data não informada'
      : parsed.toLocaleDateString('pt-BR');
  }

  function dateTime(value) {
    if (!value) {
      return 'Data não informada';
    }

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime())
      ? 'Data não informada'
      : parsed.toLocaleString('pt-BR');
  }

  // --------------------------------------------------
  // VALIDAÇÃO DE URL PARA LINKS
  // --------------------------------------------------

  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.origin);

      if (!['https:', 'http:'].includes(url.protocol)) {
        return '#';
      }

      return url.href;
    } catch {
      return '#';
    }
  }

  // --------------------------------------------------
  // NOTIFICAÇÕES
  // --------------------------------------------------

  function toast(message, type = '') {
    const old = document.querySelector('.toast');

    if (old) {
      old.remove();
    }

    const node = document.createElement('div');

    node.className = `toast ${type}`.trim();
    node.textContent = String(message ?? '');

    document.body.appendChild(node);

    setTimeout(() => {
      node.remove();
    }, 4200);
  }

  // --------------------------------------------------
  // DISPONIBILIZA AS FUNÇÕES PARA O SISTEMA
  // --------------------------------------------------

  window.ME = {
    getConfig,
    request,
    escape,
    initials,
    date,
    dateTime,
    safeUrl,
    toast
  };
})();
