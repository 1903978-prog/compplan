---
name: LinkedIn — Case study tease
agent: cmo_agent
trigger: New case study ready
slots: [client_disguised, problem, intervention, outcome, hashtags]
output: markdown
---

A {{client_disguised}} came to us with: {{problem}}.

What we did: {{intervention}}

The result: {{outcome}}

Three lessons that travel beyond this one case... [carousel below]

{{hashtags}}
