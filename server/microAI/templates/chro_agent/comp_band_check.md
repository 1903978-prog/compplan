---
name: Comp band check
agent: chro_agent
trigger: Hire, promotion, or annual review
slots: [employee, role, seniority, current_comp, proposed_comp, band_min, band_mid, band_max, market_p50, verdict, notes]
output: markdown
---

# Comp Band Check — {{employee}} ({{role}}, {{seniority}})

## Band reference

| | Amount |
|---|---|
| Band min | {{band_min}} |
| Band mid | {{band_mid}} |
| Band max | {{band_max}} |
| Market P50 | {{market_p50}} |

## Proposed change

| | Amount |
|---|---|
| Current comp | {{current_comp}} |
| Proposed comp | {{proposed_comp}} |

## Verdict

**{{verdict}}**

{{notes}}
