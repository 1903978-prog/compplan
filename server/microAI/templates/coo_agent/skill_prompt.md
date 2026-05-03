---
name: Cowork-ready skill prompt
agent: coo_agent
trigger: Recurring task pattern detected in EXCOM
slots: [skill_name, trigger_condition, inputs, steps, output_format, guardrails, examples]
output: markdown
---

# Skill: {{skill_name}}

## Trigger
{{trigger_condition}}

## Required inputs
{{#each inputs}}
- {{input}}
{{/each}}

## Steps
{{#each steps}}
{{number}}. {{step}}
{{/each}}

## Output format
{{output_format}}

## Guardrails
{{#each guardrails}}
- {{guardrail}}
{{/each}}

## Worked examples
{{examples}}
