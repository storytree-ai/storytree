/**
 * Capability 15 · Connection by address, ADR-0943 D3: the public half of the certificate storytree's
 * own library (Postgres on the Mint box) serves, for every name it is reached by (mickh-a520i-ac, its
 * Tailscale names and 100.97.8.31). It is not a secret. Pinned here, every machine that reaches that
 * library by address trusts it from the same landing that requires a checked certificate, so none
 * loses the library (ADR-0943 D4). SHA-256 90:B0:79:84:…:D3:F1:71, valid to 2036-10-05.
 */
export const STORYTREE_LIBRARY_CERTIFICATE = `
-----BEGIN CERTIFICATE-----
MIIB9zCCAZ6gAwIBAgIUeRJ7IhIyrCXNPi0IewvfiLcGqaYwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwObWlja2gtYTUyMGktYWMwHhcNMjYxMDA4MTExNTQ1WhcNMzYx
MDA1MTExNTQ1WjAZMRcwFQYDVQQDDA5taWNraC1hNTIwaS1hYzBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABHWmWohScNKEFU8sTl3YlkB/WjhgvuVMqkhDkSssAHlJ
J/tc5jXBhWw/ofEmB/uemrfnRwLX79fWue97eS0FQrGjgcMwgcAwHQYDVR0OBBYE
FKuqWj2H8DZ4ECIoufiGeH3BGb7RMB8GA1UdIwQYMBaAFKuqWj2H8DZ4ECIoufiG
eH3BGb7RMA8GA1UdEwEB/wQFMAMBAf8wWAYDVR0RBFEwT4IObWlja2gtYTUyMGkt
YWOCIG1pY2toLWE1MjBpLWFjLnRhaWwwNWE0NGQudHMubmV0ggRtaW50gglsb2Nh
bGhvc3SHBGRhCB+HBH8AAAEwEwYDVR0lBAwwCgYIKwYBBQUHAwEwCgYIKoZIzj0E
AwIDRwAwRAIgXnSq3c5J3mtVkfLWjR5g3iUoKcX5F9tX1+SvXAPXyZ0CICMC3QHm
Os8JjhcSaUUmBI17Nb4EaCzFEIawuasdtz22
-----END CERTIFICATE-----
`;
