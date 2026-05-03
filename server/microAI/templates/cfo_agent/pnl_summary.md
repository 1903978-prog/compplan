---
name: Monthly P&L summary
agent: cfo_agent
trigger: Month-end close
slots: [month, revenue, cogs, gross_margin_pct, opex, ebitda, ebitda_margin_pct, vs_budget_pct, vs_prior_month_pct, top_drivers]
output: markdown
---

# P&L Summary — {{month}}

| Line | Amount | vs Budget | vs Prior Month |
|---|---|---|---|
| Revenue | €{{revenue}} | {{vs_budget_pct}}% | {{vs_prior_month_pct}}% |
| COGS | €{{cogs}} | — | — |
| **Gross Margin** | **{{gross_margin_pct}}%** | — | — |
| OpEx | €{{opex}} | — | — |
| **EBITDA** | **€{{ebitda}}** ({{ebitda_margin_pct}}%) | — | — |

## Top drivers
{{#each top_drivers}}
- {{driver}}
{{/each}}
