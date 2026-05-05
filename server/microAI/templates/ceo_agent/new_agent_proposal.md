---
name: New agent capability proposal
agent: ceo_agent
trigger: Capability gap detected
slots: [proposed_role, mission, boss, function_area, decision_rights, initial_okrs, knowledge_seed, justification]
output: markdown
---

# Proposed new agent: {{proposed_role}}

**Mission:** {{mission}}
**Reports to:** {{boss}}
**Function area:** {{function_area}}

## Why now
{{justification}}

## Decision rights
{{decision_rights}}

## Initial OKRs (3)
{{#each initial_okrs}}
- {{objective}} → {{key_result}}
{{/each}}

## Knowledge seed (5 sources)
{{#each knowledge_seed}}
- {{source}}
{{/each}}

## Decision required from President: APPROVE / REJECT
