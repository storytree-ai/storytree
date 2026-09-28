# Pending library update — installed app updates at a quiet moment

The laptop supervisor applies [changes.patch](changes.patch) to the app story's capability
4 · Updates (`capability_6a0c1b26f586`) after merge. Record ids come from the snapshot
`2026-09-28T13-42-19-911Z`; read the current records before applying. Paths address library
fields, not repository files.

- [ ] Replace contract 4.4's title (`contract_aec036a8b4aa`): its meaning changes (owner's look: see the lane report's FOR THE OWNER).
- [ ] Replace contract 4.7's title (`contract_4b3ac966f799`): in an installed app the gear now checks published releases instead of saying updates are unavailable.
- [ ] Append the as-built paragraph to the capability's description.
- [ ] Keep 4.5, 4.8, 4.9 and 4.10 as they are: their tests are unchanged and pass.
- [ ] After merge, close `increment_aca4e6853237` using `/tmp/winupdate-close-increment_aca4e6853237.md`.
