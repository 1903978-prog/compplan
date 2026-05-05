---
name: Content calendar entry
agent: cmo_agent
trigger: Weekly content planning
slots: [date, channel, topic, angle, owner, status]
output: markdown
---

| Date | Channel | Topic | Angle | Owner | Status |
|---|---|---|---|---|---|
| {{date}} | {{channel}} | {{topic}} | {{angle}} | {{owner}} | {{status}} |
