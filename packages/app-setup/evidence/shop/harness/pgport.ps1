# Prints only the port of the app's local Postgres (never the file, which holds a token).
(Get-Content "$env:USERPROFILE\.storytree\0.3\pgdata.owner.json" | ConvertFrom-Json).port
