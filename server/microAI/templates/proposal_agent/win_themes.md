---
name: Win themes
agent: proposal_agent
trigger: Proposal strategy session
slots: [client, engagement_title, win_themes, ghost_weaknesses, proof_points]
output: markdown
---

# Win Themes — {{engagement_title}} ({{client}})

## Our win themes

{{#each win_themes}}
### {{theme.title}}
{{theme.description}}
{{/each}}

## Competitor weaknesses to exploit

{{#each ghost_weaknesses}}
- {{weakness}}
{{/each}}

## Proof points to weave in

{{#each proof_points}}
- {{proof}}
{{/each}}
