---
name: Project object schema
agent: cko_agent
trigger: New project intake
slots: [project_name, client, engagement_type, start_date, end_date, owner, objectives, deliverables, constraints, knowledge_tags]
output: markdown
---

# Project Object — {{project_name}}

**Client:** {{client}}
**Type:** {{engagement_type}}
**Period:** {{start_date}} → {{end_date}}
**Owner:** {{owner}}

## Objectives

{{#each objectives}}
- {{objective}}
{{/each}}

## Deliverables

{{#each deliverables}}
- {{deliverable}}
{{/each}}

## Constraints

{{#each constraints}}
- {{constraint}}
{{/each}}

## Knowledge tags

{{#each knowledge_tags}}
`{{tag}}`
{{/each}}
