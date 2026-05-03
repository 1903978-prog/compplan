---
name: Training packet
agent: ld_manager
trigger: New training initiative
slots: [training_title, target_audience, learning_objectives, modules, duration, delivery_format, facilitator, materials_needed]
output: markdown
---

# Training Packet — {{training_title}}

**Audience:** {{target_audience}}
**Duration:** {{duration}}
**Format:** {{delivery_format}}
**Facilitator:** {{facilitator}}

## Learning objectives

By the end of this training, participants will be able to:
{{#each learning_objectives}}
- {{objective}}
{{/each}}

## Modules

{{#each modules}}
### {{module.title}} ({{module.duration}})
{{module.description}}
{{/each}}

## Materials needed

{{#each materials_needed}}
- {{material}}
{{/each}}
