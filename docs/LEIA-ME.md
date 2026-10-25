# Meu Engenheiro — versão de interface

Esta versão reorganiza a interface em arquivos separados, mantendo as tabelas existentes do Supabase (`clientes` e `arquivos`) e o upload para Cloudinary.

## Estrutura

- `server.js`: servidor Express e rota `/api/config`.
- `public/index.html`: painel de gestão.
- `public/login-cliente.html`: entrada do cliente.
- `public/painel-cliente.html`: área de acompanhamento da obra.
- `public/assets/css/app.css`: estilos compartilhados.
- `public/assets/js/api.js`: funções compartilhadas de configuração, acesso ao Supabase, escape de texto e notificações.
- `public/assets/js/admin.js`: painel, cadastro de clientes, detalhe da obra e anexos.
- `public/assets/js/login.js`: formulário de login.
- `public/assets/js/painel.js`: painel do cliente.
- `public/assets/img/logo-engenheiro.svg`: espaço reservado para a logo do engenheiro.
- `public/assets/img/logo-desenvolvimento.svg`: espaço reservado para a logo de desenvolvimento.

## Deploy no Render

1. Faça backup do projeto atual antes de substituir os arquivos.
2. Envie o conteúdo desta pasta para o repositório conectado ao Render.
3. Mantenha o comando de build vazio (não há etapa de build) e o start command `npm start`.
4. Mantenha configuradas as variáveis `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDINARY_CLOUD_NAME` e `CLOUDINARY_PRESET` no serviço do Render.
5. Confirme que `SUPABASE_KEY` é uma chave pública `anon`/`publishable`; nunca use `service_role` ou outra chave secreta no navegador.
6. Confira as políticas RLS do Supabase para que usuários públicos só possam executar as operações previstas. Esta versão mantém o modelo de integração do projeto original e não implementa uma nova camada de autenticação.
7. Teste a criação de um cliente, login, abertura do painel, upload de imagem/PDF e abertura do arquivo.

## Colocar as logos

Substitua os arquivos `public/assets/img/logo-engenheiro.svg` e `public/assets/img/logo-desenvolvimento.svg` pelas suas imagens. Se usar PNG ou JPG, atualize os caminhos nos HTML/JS para a extensão escolhida. Os dois espaços já aparecem no painel de gestão, login e área do cliente.

## Compatibilidade e observações

- O login agora redireciona para `/painel-cliente.html`, que é o nome do painel incluído no projeto. A rota antiga `/minha-obra.html` também redireciona para o painel.
- Os números do painel são calculados com os dados existentes; não há taxa fictícia de entrega nem faturamento inventado.
- A linha do tempo do cliente está identificada como ilustrativa, porque o banco atual não fornece etapas detalhadas.
- A autenticação por comparação de senha no REST do Supabase é mantida apenas para compatibilidade com o banco existente. Para produção, recomenda-se migrar para Supabase Auth, remover senhas em texto puro e configurar políticas RLS por identidade autenticada antes de colocar dados reais de clientes.
