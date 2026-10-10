# Persistent SQLite v12 fixture

`harness.sqlite` was created before the task64 dependency upgrade with installed `better-sqlite3` **12.11.1**, using the unchanged `SQLiteDriver` and schema at source commit `102be0e`. It is synthetic test data; no user harness database was read or copied.

Capture used Node25.2.1 on macOS arm64, SQLite3.53.2. It inserted task7, acceptance9, action11 and section13, with explicit parent relationships and Unicode text. `PRAGMA wal_checkpoint(TRUNCATE)` completed before the connection closed. `provenance.json` records the writer/runtime and SHA256 of the closed file.

The compatibility regression copies this pristine file into a disposable directory, checks its checksum before and after, and exercises the current adapter's schema idempotence, foreign keys, writes, commit/rollback and reopen. Do not regenerate this file with the current dependency: that would erase the cross-version evidence.
