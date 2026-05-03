---
name: Proposal section from past project
agent: proposal_agent
trigger: Relevant past project found in knowledge base
slots: [past_project_name, client_sector, challenge_parallel, approach_used, outcomes_achieved, relevance_to_current]
output: markdown
---

## Relevant experience — {{past_project_name}}

**Sector:** {{client_sector}}

**Similar challenge:** {{challenge_parallel}}

**What we did:** {{approach_used}}

**Outcomes:**
{{#each outcomes_achieved}}
- {{outcome}}
{{/each}}

**Why it's relevant:** {{relevance_to_current}}
