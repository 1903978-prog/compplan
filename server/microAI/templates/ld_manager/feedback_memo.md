---
name: L&D feedback memo
agent: ld_manager
trigger: Post-training evaluation
slots: [training_title, delivery_date, participant_count, satisfaction_score, strengths, improvement_areas, next_iteration_changes, owner]
output: markdown
---

# L&D Feedback Memo — {{training_title}}

**Delivered:** {{delivery_date}}
**Participants:** {{participant_count}}
**Satisfaction score:** {{satisfaction_score}}/5

## What worked well

{{#each strengths}}
- {{strength}}
{{/each}}

## Areas for improvement

{{#each improvement_areas}}
- {{area}}
{{/each}}

## Changes for next iteration

{{#each next_iteration_changes}}
- {{change}}
{{/each}}

**Owner:** {{owner}}
