---
name: Curriculum update memo
agent: ld_manager
trigger: Curriculum revision cycle
slots: [curriculum_name, review_date, changes_made, rationale, impacted_roles, effective_date, owner]
output: markdown
---

# Curriculum Update — {{curriculum_name}}

**Review date:** {{review_date}}
**Effective date:** {{effective_date}}
**Owner:** {{owner}}

## Changes made

{{#each changes_made}}
- {{change}}
{{/each}}

## Rationale

{{rationale}}

## Impacted roles

{{#each impacted_roles}}
- {{role}}
{{/each}}
