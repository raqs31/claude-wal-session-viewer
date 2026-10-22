# Orchestrate

How `/mario:orchestrate` runs in this repo: dispatch, reviews, phase ends.

## Fix all review findings without asking

**Mistake:** At each phase end I asked the user which minor review follow-ups to fix; they said to fix them without their attention.
**Rule:** Fix every review finding and follow-up without asking, scope-adding ones included: reopen the owner ticket or have the planner add a ticket in the same phase, re-review, then commit the phase.
**Trigger:** A mario:reviewer verdict comes back with findings or Follow-ups during /mario:orchestrate.
