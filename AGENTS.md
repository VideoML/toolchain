# VideoML project coordination

Use Kanbus for work tracking. The shared VideoML board lives in this repository at `project/`, configured by `.kanbus.yml`. Coordinate work across specification, player, stdlib, toolchain, cli, and videoml-org here, identifying the owning repository in each issue.

Use `kbs` commands to create, inspect, and update issues; do not edit issue JSON directly. Create or select the relevant issue before implementation and include acceptance evidence before closing it.

The `Hyperframes inspiration` initiative (`videoml-dbc2b1`) is the canonical plan for the effects/catalog effort. Maintain its main description as the living initiative document. Use milestone epics, behavior stories, and concrete tasks beneath it.

Preserve framework-agnostic frame-driven animation. VideoML's visual catalog must run without Babulus or voiceover credentials. VideoML includes standard voiceover with open Auritus-backed local synthesis. Improve reusable TTS capabilities in Auritus. Babulus is an optional paid rendering platform with portable projects and local-first workers plus bounded AWS Batch fallback; do not introduce vendor lock-in.

## Implementation dispatch

The user has requested gpt-6.1-terra subagents for this initiative. The primary agent owns architecture and acceptance. Follow canonical initiative videoml-dbc2b1 D01–D16 and its ordered P/C packets. Workers must not close their own issues or weaken verification; return evidence to the primary reviewer. No concurrent writers to a shared checkout. Local work is independent of the real-account provisioning gate.

At current disk pressure, follow D16: max two implementation workers, one heavyweight operation, 8 GiB free-space floor. Primary owns board writes and resource scheduling. Begin with P00 resource preflight before P01.
