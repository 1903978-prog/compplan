---
name: RACI update memo
agent: coo_agent
trigger: New section added or RACI gap detected
slots: [section, responsible, accountable, consulted, informed, gap_type]
output: markdown
---

# RACI update — {{section}}

| Role | Person/Agent |
|---|---|
| Responsible | {{responsible}} |
| Accountable | {{accountable}} |
| Consulted | {{consulted}} |
| Informed | {{informed}} |

**Gap closed:** {{gap_type}}
