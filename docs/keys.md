# Keys

Storytree borrows the logins you already have (Claude Code or Codex, `gh`, Google sign-in), so most
people never give it a key. When a feature does need one, save it once, typed or piped in, never
as an argument:

```sh
storytree auth set anthropic      # then type or paste the key; nothing is shown
storytree auth list               # names and where each comes from, never the values
storytree auth remove anthropic
```

The app, the command line and the agent's tools all find it. It is kept in `auth.json` in
storytree's home (`~/.storytree/0.3`, or `STORYTREE_HOME`), readable only by you. A key given on a
command wins over the saved one, and the saved one over its environment variable (such as
`ANTHROPIC_API_KEY`).

To keep a key in your own store instead, save a command that prints it, starting with `!`.
Storytree runs it once per process when the key is needed:

```sh
echo '!op read op://Private/Anthropic/credential' | storytree auth set anthropic
echo '!gcloud secrets versions access latest --secret=anthropic-key' | storytree auth set anthropic
```

A library reached by a Postgres address keeps its password the same way, as the key `postgres`,
never in the address:

```sh
storytree settings set library postgres 'postgres://me@db.example.com:5432/postgres?sslmode=require'
storytree auth set postgres       # then type or paste the database password
```

## Keys on CI

A CI runner starts fresh every run, so it has no `auth.json` and storytree keeps nothing for it.
Put each key in the CI platform's own secret store and hand it to the job as an environment
variable, which storytree reads last in its order. For a library reached by address, that is
`PGPASSWORD` (GitHub Actions shown):

```yaml
- run: storytree settings set library postgres "postgres://ci@db.example.com:5432/postgres?sslmode=require"
- run: storytree arc list
  env:
    PGPASSWORD: ${{ secrets.STORYTREE_LIBRARY_PASSWORD }}
```

A Cloud SQL instance is reached the same way: as a Postgres address, through the Cloud SQL Auth
Proxy or its public IP, signed in as an ordinary database user whose password is the key.
Storytree no longer signs in to Google itself.
