# English Arcade

Caderno de inglês com professor no chat, em estilo arcade. Criado por Kevin Paulo · @Arkev.arq.

**App:** https://kevinpaulor.github.io/english-arcade/
**Central do administrador:** https://kevinpaulor.github.io/english-arcade/admin.html

## O que tem
- Chat com professor (Gemini pelo Firebase AI Logic): correção, níveis FÁCIL / MÉDIO / NATIVO, palavras coloridas, + exemplos e explicar mais.
- Caderno com as aulas por data (calendário), sumário por assunto e páginas para folhear.
- Caderno pessoal com todas as conversas salvas, pontuação, exportação do progresso (arquivo e email) e backup.
- Perfil "EU", pessoas com cor, lugares, objetos, ações e memória livre usados nas conversas.
- Voz 8-bit (SAM), voz do aparelho e microfone do navegador.
- Login com Google, email (senha ou link) ou sem conta.
- Central do administrador: quem está online, tempo de uso, sugestões e liberação de versões.

## Estrutura
```
docs/index.html          porta de entrada (abre a versão liberada)
docs/versions.json       versões padrão e em teste
docs/v/1/                o app (index.html, backend.js, lessons.js, firebase-config.js)
docs/admin.html          central do administrador
firestore.rules          regras de segurança do Firestore
```

## Publicar uma versão nova
1. Copie `docs/v/1` para `docs/v/2` e faça as mudanças.
2. Em `docs/versions.json`, ponha `"beta": 2`.
3. Teste pelo botão 🧪 na central e toque em ✅ APROVAR PARA TODOS.
