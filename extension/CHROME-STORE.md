# Publicar o Rift Ranked na Chrome Web Store

Tudo que você precisa para subir a extensão. O pacote já está pronto.

## Arquivo para subir
`extension/rift-ranked-chrome-0.3.28.zip`
(gere novas versões com: `pwsh -File scripts/build-chrome-zip.ps1`)

Conteúdo do zip: `manifest.json` (versão Chrome, sem o bloco `gecko` do Firefox) + `dist/inpage.js` + `dist/content.js`.

## Passo a passo
1. Acesse o **Developer Dashboard**: https://chrome.google.com/webstore/devconsole
2. Pague a **taxa única de US$ 5** (se ainda não tiver conta de desenvolvedor).
3. **Add new item** → faça upload do `.zip` acima.
4. Preencha o **Store listing** (textos abaixo).
5. Em **Privacy practices**, cole as justificativas abaixo e informe a URL da política.
6. Escolha a **visibilidade** (recomendo *Não listado* — veja a nota no fim).
7. **Submit for review**.

## Ícone (você fornece)
A loja exige um **ícone 128×128 PNG** (enviado direto no painel, não precisa estar no zip).
Qualquer logo quadrado do Rift Ranked serve.

## Imagens exigidas
- 1 ícone 128×128.
- Pelo menos **1 screenshot 1280×800** (ou 640×400). Pode ser um print do overlay do ranqueado em cima do RiftAtlas.

---

## Store listing — textos

**Nome**
```
Rift Ranked
```

**Resumo curto (até 132 caracteres)**
```
Ranqueado por MMR para o RiftAtlas: fila, pareamento, ladder e estatísticas de Legends (Md1 e Md3).
```

**Descrição**
```
Rift Ranked adiciona um sistema de ranqueado competitivo ao simulador RiftAtlas (play.riftatlas.com).

Recursos:
• Fila e pareamento automático por MMR (sistema Glicko-2).
• Formatos Md1 e Md3.
• Ladder com posições, ratings e perfis de jogador.
• Estatísticas por Legend: winrate, pickrate e confrontos Legend vs Legend.
• Confirmação do vencedor ao fim da partida e reputação (curtir/não curtir).
• Detecção de queda/saída do oponente, com janela de reconexão.

Projeto de fãs, sem afiliação com a Riot Games ou com os operadores do RiftAtlas.
```

**Categoria:** Jogos (ou Ferramentas)
**Idioma:** Português (Brasil)

---

## Privacy practices — o que marcar

**URL da política de privacidade**
```
https://app.megacards.com.br/ranked/privacidade
```

**Finalidade única (single purpose)**
```
Adicionar um sistema de ranqueado (fila, pareamento e estatísticas) ao simulador RiftAtlas.
```

**Justificativa de cada permissão**
- `storage`:
```
Salvar preferências locais do usuário (idioma e sons) no próprio navegador.
```
- Host `play.riftatlas.com`:
```
Ler o estado da partida em andamento (fase, placar e Legend) para detectar início, fim e vencedor.
```
- Host `app.megacards.com.br`:
```
Comunicar com o servidor do ranqueado (fila, pareamento, resultados e estatísticas).
```

**Uso de dados — declare:**
- Coleta identificador/nome do jogador e dados de partida (resultado, Legend, placar). ✔
- NÃO vende dados a terceiros. ✔
- NÃO usa/transfere dados para fins não relacionados à função principal. ✔
- NÃO usa dados para avaliação de crédito/empréstimo. ✔

---

## Visibilidade: recomendação
Como é uma ferramenta de comunidade sobre um simulador não-oficial, use **"Não listada" (Unlisted)**:
- Não aparece na busca da loja, mas qualquer pessoa com o link instala com 1 clique.
- Revisão costuma ser mais tranquila.
- Você compartilha o link no Discord/grupo.

Se quiser alcance total na busca, escolha **"Pública"** (revisão mais rigorosa).

## Depois de aprovado
O Chrome passa a **atualizar a extensão sozinho**. Extensão publicada na loja **não pode** usar
atualização self-hosted (`update_url`) — então o aviso de versão via `version.json` vira só informativo
ou pode apontar para o link da loja.
