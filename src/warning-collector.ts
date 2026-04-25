export class WarningCollector {
  private counts: Map<string, number> = new Map();
  private verbose: boolean;

  constructor(verbose: boolean) {
    this.verbose = verbose;
  }

  warn(category: string, detail: string) {
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
    if (this.verbose) console.warn(detail);
  }

  debug(category: string, detail: string) {
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
    if (this.verbose) console.debug(detail);
  }

  printSummary() {
    if (this.counts.size === 0) return;
    console.log('\nWarning summary:');
    for (const [category, count] of this.counts) {
      console.log(`  ${count} resource(s): ${category}`);
    }
  }
}
