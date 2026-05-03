---
name: Blocker alert
agent: delivery_officer
trigger: Blocker identified
slots: [project_name, client, blocker_title, description, impact, owner, escalation_path, deadline_to_resolve]
output: markdown
---

# Blocker Alert — {{project_name}}

**Client:** {{client}}
**Deadline to resolve:** {{deadline_to_resolve}}

## Blocker

**{{blocker_title}}**

{{description}}

## Impact if unresolved

{{impact}}

## Owner

{{owner}}

## Escalation path

{{escalation_path}}
