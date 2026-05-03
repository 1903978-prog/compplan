---
name: Archetype card
agent: cko_agent
trigger: Pattern identified across projects
slots: [archetype_name, description, typical_client, entry_signals, recommended_approach, pitfalls, example_projects, tags]
output: markdown
---

# Archetype Card — {{archetype_name}}

**Description:** {{description}}

**Typical client:** {{typical_client}}

## Entry signals

{{#each entry_signals}}
- {{signal}}
{{/each}}

## Recommended approach

{{recommended_approach}}

## Common pitfalls

{{#each pitfalls}}
- {{pitfall}}
{{/each}}

## Example projects

{{#each example_projects}}
- {{project}}
{{/each}}

**Tags:** {{#each tags}}`{{tag}}` {{/each}}
