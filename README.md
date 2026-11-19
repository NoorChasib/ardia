# Nilla Layer 1 tools

The tools that produced branch nilla/layer1, kept so the rename can be redone on a new base and the naming allowlist
can be rebuilt. They ran from /home/noor/ardia-work/nila-cleanup on the lead's Linux machine.

- tools/nilla_rename.py: the deterministic rename (see --help); tools/test_nilla_rename_gate.py: its gate tests.
- tools/naming_census.py, tools/ownership_v2.py, tools/remap_lists.py: the name census, per-owner file lists and the
  post-rename list remap. work/eng_*.txt and work/iface_lits.txt are the engine-derived inputs (valid while the engine
  key is 2d8afa2a646dd570e1b13034b52a62e3806a2fef).
- work/wave0/allowlist/build_allowlist.py: regenerates apps/browser/src/naming-allowlist.json from the ownership lists,
  hand-lines.json and the engine literal scans.
- tools/isolate/: the Linux isolation and no-upstream harness (README inside; its Python venv is not archived).
- plan-v2.md, owner-requirements.md, work/decisions.md: the plan, the owner's decisions and the lead's decisions.
