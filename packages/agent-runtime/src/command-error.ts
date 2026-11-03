/** Expected malformed/redelivered command; it must not kill an otherwise healthy runtime. */
export class RuntimeCommandRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeCommandRejected';
  }
}
