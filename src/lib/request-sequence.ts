// A token is valid only until a newer request or local mutation supersedes it.
export class RequestSequence {
  private version = 0;
  begin() {
    return ++this.version;
  }
  invalidate() {
    ++this.version;
  }
  isCurrent(token: number) {
    return token === this.version;
  }
  async run<T>(work: () => Promise<T>, apply: (result: T) => void) {
    const token = this.begin();
    const result = await work();
    if (this.isCurrent(token)) apply(result);
  }
}
