# My own Conduit backend

I want this existing Conduit app to use my own backend instead of the public
demo server, with a database that keeps my data after a restart. Keep the
existing frontend and storytree project.

Use the official RealWorld API specification and acceptance collection:

- Project: https://github.com/realworld-apps/realworld
- API specification: https://github.com/realworld-apps/realworld/blob/ebbcdeb8d55b42a3a613c787560498b8ef10003f/specs/api/openapi.yml
- API tests: https://github.com/realworld-apps/realworld/tree/ebbcdeb8d55b42a3a613c787560498b8ef10003f/specs/api/hurl
- Frontend tests: https://github.com/realworld-apps/realworld/tree/ebbcdeb8d55b42a3a613c787560498b8ef10003f/specs/e2e

Plan this in storytree in manageable parts: users and authentication, articles,
comments, profiles and following, and tags and favourites. Choose the stack;
it should run locally without a paid service or new external credentials.
Represent the backend in the same project's plan and record the real
dependencies between frontend and backend.

Build one part per fresh session, using a branch or storytree workspace and a
pull request. Extend the pipeline to run the official API tests through each
completed part and keep earlier parts green. Record each merged pull request
and its result in the library. Do not change the official tests to hide failures.

Once the frontend can use the new backend, run the official frontend suite
against it too. The suite supports `TEST_MODE=fullstack` for an app that owns
its backend; report its intentional skips separately from passes. The existing
frontend against the demo API already passes all 139 tests after retries.

The API test runner is `specs/api/run-api-tests-hurl.sh`. Its `HOST` is the
server origin without `/api`, because requests append that path themselves.
The frontend suite's `API_BASE` includes `/api`. Document how to start and test
the finished app from a fresh terminal on Windows and in CI.
