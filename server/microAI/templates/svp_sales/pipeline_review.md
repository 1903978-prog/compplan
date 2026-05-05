---
name: Weekly pipeline review
agent: svp_sales
trigger: Every Monday 9am
slots: [week_of, total_pipeline, weighted_pipeline, coverage_ratio, deals_added, deals_lost, deals_slipped, top_5]
output: markdown
---

# Pipeline Review — Week of {{week_of}}

| Metric | Value |
|---|---|
| Total pipeline | €{{total_pipeline}} |
| Weighted pipeline | €{{weighted_pipeline}} |
| Coverage ratio | {{coverage_ratio}}x |
| Added this week | {{deals_added}} |
| Lost this week | {{deals_lost}} |
| Slipped this week | {{deals_slipped}} |

## Top 5 deals to push
{{#each top_5}}
{{rank}}. **{{client}}** — €{{value}} ({{stage}}, prob {{probability}}%) — Action: {{next_action}}
{{/each}}
