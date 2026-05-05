---
name: 30-60-90 day onboarding plan
agent: chro_agent
trigger: New hire confirmed
slots: [employee, role, start_date, day30_milestones, day60_milestones, day90_milestones, buddy, key_stakeholders]
output: markdown
---

# 30-60-90 Day Onboarding Plan — {{employee}} ({{role}})

**Start date:** {{start_date}}
**Buddy:** {{buddy}}

## Days 1–30: Learn & Orient

**Milestones**
{{#each day30_milestones}}
- {{milestone}}
{{/each}}

**Key stakeholders to meet**
{{#each key_stakeholders}}
- {{name}} — {{context}}
{{/each}}

## Days 31–60: Contribute & Build

{{#each day60_milestones}}
- {{milestone}}
{{/each}}

## Days 61–90: Lead & Deliver

{{#each day90_milestones}}
- {{milestone}}
{{/each}}

## Check-in schedule

| Milestone | Owner | Date |
|---|---|---|
| Day 30 review | Manager + {{employee}} | Day 30 |
| Day 60 review | Manager + {{employee}} | Day 60 |
| Day 90 review | Manager + CHRO | Day 90 |
