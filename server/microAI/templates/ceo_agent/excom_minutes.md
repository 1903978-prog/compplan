---
name: EXCOM weekly minutes
agent: ceo_agent
trigger: After Friday EXCOM run
slots: [week_of, theme, agent_updates, top_3_decisions, conflicts_to_escalate, narrative]
output: markdown
---

# EXCOM Minutes — Week of {{week_of}}

**This week's theme:** {{theme}}

## Agent updates
{{#each agent_updates}}
### {{agent}}
- Status vs OKRs: {{status}}
- Top tasks in flight: {{tasks}}
- Cross-agent dependencies: {{dependencies}}
- Decisions needed: {{decisions_needed}}
{{/each}}

## Top 3 weekly decisions for the President
{{#each top_3_decisions}}
{{number}}. **{{decision}}** — {{recommendation}}
{{/each}}

## Conflicts to escalate
{{#each conflicts_to_escalate}}
- {{conflict}}
{{/each}}

## CEO narrative
{{narrative}}
