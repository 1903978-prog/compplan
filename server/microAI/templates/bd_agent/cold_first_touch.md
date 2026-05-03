---
name: Cold outreach — first touch
agent: bd_agent
trigger: New prospect identified
slots: [prospect_name, prospect_role, prospect_company, sector, pain_point, our_angle, sender_name, sender_role]
output: markdown
---

Subject: {{prospect_company}} — quick thought

Hi {{prospect_name}},

I noticed {{prospect_company}} is navigating {{pain_point}}.

At Eendigo, we help {{sector}} leaders {{our_angle}}. I'd love to share a quick perspective — no pitch, just a 20-minute conversation.

Worth a call?

{{sender_name}}
{{sender_role}}, Eendigo
