---
name: Follow-up after discovery call
agent: bd_agent
trigger: Discovery call completed
slots: [prospect_name, call_date, key_themes, proposed_next_step, materials_attached, sender_name]
output: markdown
---

Subject: Following up — {{call_date}}

Hi {{prospect_name}},

Thanks for the time today. A few things I took from our conversation:

{{#each key_themes}}
- {{theme}}
{{/each}}

**Proposed next step:** {{proposed_next_step}}

{{#each materials_attached}}
- {{material}}
{{/each}}

Let me know if this captures it well — happy to adjust based on your priorities.

{{sender_name}}
Eendigo
