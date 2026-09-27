# The app can be controlled from outside

- **Front cover of:** stories/app.md, capability 1
- **Full record:** ADR-0656 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0656`)

What a person can do to the running app, an agent can ask it to do from the command line.

The owner, 2026-09-27, answering whether the app may be quit from outside and keep its own verified
health current: "yes to both d1 and d2 in general the app should be able to be controlled from the
outside - this allows frontend agents to better test the app and helps with model driven uat
testing".

First, `storytree app quit` asks the running app to quit as its tray's Quit does, so scripts and
sessions stop force-killing it. After the library's one-copy flip, the app also runs the own-health
check after each update (Updates). Further controls come as the testing work asks for them.
