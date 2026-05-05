---
name: Warm intro outreach
agent: bd_agent
trigger: Referral or warm introduction received
slots: [prospect_name, prospect_company, referrer_name, context, our_angle, sender_name, sender_role]
output: markdown
---

Subject: Introduction via {{referrer_name}}

Hi {{prospect_name}},

{{referrer_name}} suggested I reach out — {{context}}.

At Eendigo, {{our_angle}}. Given what {{referrer_name}} shared about your priorities, I think there's a real conversation to be had.

Would a 30-minute call next week work?

{{sender_name}}
{{sender_role}}, Eendigo
