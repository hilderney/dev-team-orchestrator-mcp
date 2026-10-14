# LangGraph Studio (zteam)

Topologia do pipeline zteam (nós/edges: workflowRouter → SA → TA → SE → QA → …).

**Não** espelha runs MCP ao vivo — só a estrutura do grafo.

## Abrir

```bash
node .zteam/langgraph/dev.mjs
```

Depois abre:

https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

O launcher corre o Agent Server no **pacote MCP** (onde `langgraph.json` e as deps vivem). O path está em `package-root.json` (atualizado em cada bootstrap).

## Offline

Dump Mermaid: `.docs/langgraph.mmd` (copiado do pacote MCP quando disponível).

No pacote MCP: `npm run studio` ou `npm run graph`.
