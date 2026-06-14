## Run your first check

Open the **gate** icon in the Activity Bar, or run **gate: Check Workspace** from
the Command Palette.

You get one normalized verdict:

| Status | Meaning |
| --- | --- |
| ✓ pass | every check that ran is clean |
| ⚠ warn | something worth a look — not blocking |
| ✗ fail | a blocking problem; do not ship |

Findings that carry a line (aiglare red surfaces, tieline drift) show up as inline
squiggles you can click to jump to. The **Verdict** cockpit summarizes all four
domains; the **Checks** tree lets you drill into individual findings.

Re-checks run automatically on save (toggle with `gate.runOnSave`).
