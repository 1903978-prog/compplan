---
name: Cold outreach — second touch
agent: bd_agent
trigger: No reply after first touch (7–10 days)
slots: [prospect_name, prospect_company, original_angle, new_hook, sender_name]
output: markdown
---

Subject: Re: {{prospect_company}} — one more thought

Hi {{prospect_name}},

Looping back on my note from last week.

{{new_hook}}

If {{original_angle}} isn't a priority right now, happy to shelve this — just let me know. Otherwise, I'm available for a brief call whenever suits you.

{{sender_name}}
Eendigo
