declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  interface Database {
    run(sql: string, params?: (string | number)[]): void
    exec(sql: string, params?: (string | number)[]): QueryExecResult[]
    export(): Uint8Array
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  const initSqlJs: () => Promise<SqlJsStatic>
  export default initSqlJs
  export type { Database as Database }
}
