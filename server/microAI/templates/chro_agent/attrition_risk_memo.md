---
name: Attrition risk memo
agent: chro_agent
trigger: Signal detected (engagement drop, absence spike, market offer)
slots: [employee, role, risk_level, signals, root_causes, retention_levers, recommended_action, deadline]
output: markdown
---

# Attrition Risk Memo — {{employee}} ({{role}})

**Risk level:** {{risk_level}}
**Action required by:** {{deadline}}

## Signals detected

{{#each signals}}
- {{signal}}
{{/each}}

## Root cause analysis

{{#each root_causes}}
- {{cause}}
{{/each}}

## Retention levers available

{{#each retention_levers}}
- **{{lever}}**: {{detail}}
{{/each}}

## Recommended action

{{recommended_action}}

---
*This memo is confidential — HR and direct manager only.*
