---
name: Reactivation outreach
agent: bd_agent
trigger: Prospect gone cold (60+ days)
slots: [prospect_name, prospect_company, last_contact_date, reactivation_hook, sender_name]
output: markdown
---

Subject: Checking back in — {{prospect_company}}

Hi {{prospect_name}},

It's been a while since we spoke — hope things are going well at {{prospect_company}}.

{{reactivation_hook}}

If the timing is better now, I'd love to reconnect. Even a 15-minute catch-up would be valuable.

{{sender_name}}
Eendigo
