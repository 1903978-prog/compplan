---
name: Case study extract
agent: cko_agent
trigger: Project close-out
slots: [project_name, client_sector, challenge, approach, results, reusable_assets, lessons_learned, tags]
output: markdown
---

# Case Study Extract — {{project_name}}

**Sector:** {{client_sector}}

## Challenge

{{challenge}}

## Approach

{{approach}}

## Results

{{#each results}}
- {{result}}
{{/each}}

## Reusable assets

{{#each reusable_assets}}
- {{asset}}
{{/each}}

## Lessons learned

{{#each lessons_learned}}
- {{lesson}}
{{/each}}

**Tags:** {{#each tags}}`{{tag}}` {{/each}}
