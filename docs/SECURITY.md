# Security Model

## Defended

- **SQL Injection**: All parameters (queue names, payloads, attempts, timestamps) are bound via parameterized queries. Table identifiers are validated against `^[a-z_][a-z0-9_]{0,62}$` before interpolation into DDL or queries.
- **Denial of Service**: Payload sizes are hard-capped at 65,536 bytes to prevent storage-based resource exhaustion.
- **Storage Growth**: Error messages are truncated to 1,000 UTF-16 code units before storage in the database.

## Not Defended

- **Application logic errors**: The handler function in `processBatch` is responsible for its own security concerns.
- **Database permissions**: The library assumes the provided `Db` client has the necessary permissions to `INSERT`, `UPDATE`, and `SELECT` on the designated table.
