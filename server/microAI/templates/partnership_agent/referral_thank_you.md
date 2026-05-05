---
name: Referral thank you
agent: partnership_agent
trigger: Referral received and qualified
slots: [referrer_name, referrer_company, referred_client, outcome_so_far, sender_name]
output: markdown
---

Subject: Thank you for the introduction — {{referred_client}}

Hi {{referrer_name}},

I wanted to personally thank you for introducing us to {{referred_client}}. The conversation has been very promising.

{{outcome_so_far}}

We truly value your confidence in Eendigo and look forward to keeping you in the loop as things progress. If there's ever anything we can do to support you or {{referrer_company}}, please don't hesitate to reach out.

{{sender_name}}
Eendigo
