declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  interface Database {
    run(sql: string, params?: unknown[]): void
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    prepare(sql: string, params?: unknown[]): Statement
    export(): Uint8Array
  }

  interface Statement {
    run(params?: unknown[]): void
    free(): void
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  const initSqlJs: () => Promise<SqlJsStatic>
  export default initSqlJs
  export type { Database as Database }
}
