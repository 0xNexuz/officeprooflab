export class StoreError extends Error {
  code: 'not_found' | 'conflict' | 'invalid' | 'rate_limited' | 'forbidden';
  constructor(code: 'not_found' | 'conflict' | 'invalid' | 'rate_limited' | 'forbidden', message: string) {
    super(message);
    this.code = code;
  }
}
