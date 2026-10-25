
async function request(table, method = 'GET', body = null, query = '') {
  // Arquivos passam pelo servidor para não depender da política
  // RLS do navegador para gravar os metadados.
  if (table === 'arquivos') {
    let endpoint = '/api/arquivos';

    if (method === 'GET') {
      const params = new URLSearchParams(
        query.startsWith('?') ? query.slice(1) : query
      );

      const rawId = params.get('cliente_id') || '';
      const clienteId = rawId.startsWith('eq.')
        ? rawId.slice(3)
        : rawId;

      if (!clienteId) {
        throw new Error('Não foi informado o cliente da obra.');
      }

      endpoint += `?cliente_id=${encodeURIComponent(clienteId)}`;
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
        ? (data.error || data.message || data.details || data.hint)
        : data;

      throw new Error(message || `Falha ao acessar arquivos (${response.status}).`);
    }

    return data;
  }

  // Os demais dados continuam usando o acesso atual ao Supabase.
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
      ? (data.message || data.details || data.hint)
      : data;

    throw new Error(message || `Falha ao acessar ${table} (${response.status}).`);
  }

  return data;
}
