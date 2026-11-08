# Arcade 2.10.1

Trolley Trouble route cards are native buttons. Each contains its track, stakes
and action label, with keyboard focus and a full-card touch target. Duplicate
route buttons are removed. Emergency-brake and random-draw choices remain
separate; a track without a matching choice stays informational. Once chosen,
route cards are disabled and only the consequence and Next remain actionable.

Local verification: all36 scenarios and73 option branches through native tap/
keyboard; four layouts; observer mutation blocking; all seven existing focused
Train browser groups; complete offline manifest hashes. Focused CI checks the
same browser flows, train/trolley models and actual Worker control transfers.
Earlier2.10.0 coverage remains in arcade-stress-test-2.10.0.md.
