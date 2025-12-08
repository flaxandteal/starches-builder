import * as readline from 'readline';

interface ProgressBar {
  id: string;
  label: string;
  current: number;
  total: number;
  startTime: number;
  completed: boolean;
}

export class ProgressDisplay {
  private progressBars: Map<string, ProgressBar> = new Map();
  private logs: string[] = [];
  private isEnabled: boolean = false;
  private lastRenderTime: number = 0;
  private readonly RENDER_THROTTLE_MS = 30; // Update max 33 times per second
  private readonly MIN_HEIGHT = 10;
  private currentHeight: number = 0;
  private originalConsole: { log: typeof console.log; error: typeof console.error; warn: typeof console.warn } | null = null;
  private pendingRender: NodeJS.Timeout | null = null;
  private hasNewLogs: boolean = false;

  constructor() {}

  enable() {
    this.isEnabled = true;
    this.interceptConsole();
    // Hide cursor to prevent flickering
    process.stdout.write('\x1B[?25l');
  }

  private interceptConsole() {
    if (this.originalConsole) return; // Already intercepted

    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn
    };

    const self = this;

    console.log = function(...args: any[]) {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      self.log(message);
    };

    console.error = function(...args: any[]) {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      self.log(`ERROR: ${message}`);
    };

    console.warn = function(...args: any[]) {
      const message = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      self.log(`WARN: ${message}`);
    };
  }

  private restoreConsole() {
    if (!this.originalConsole) return;

    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    this.originalConsole = null;
  }

  /**
   * Log a message to the console output
   */
  log(message: string) {
    if (!this.isEnabled) {
      if (this.originalConsole) {
        this.originalConsole.log(message);
      } else {
        console.log(message);
      }
      return;
    }

    // Split multi-line messages into separate log entries
    const lines = message.split('\n');
    for (const line of lines) {
      if (line.trim()) { // Skip empty lines
        this.logs.push(line);
        this.hasNewLogs = true;
      }
    }
    this.render();
  }

  /**
   * Create or update a progress bar
   */
  progress(id: string, label: string, current: number, total: number) {
    if (!this.isEnabled) {
      // Fallback to simple logging
      if (current === 0) {
        console.log(`Starting: ${label}`);
      } else if (current >= total) {
        console.log(`Completed: ${label} (${total} items)`);
      }
      return;
    }

    let progressBar = this.progressBars.get(id);

    if (!progressBar) {
      progressBar = {
        id,
        label,
        current: 0,
        total,
        startTime: Date.now(),
        completed: false
      };
      this.progressBars.set(id, progressBar);
    }

    progressBar.current = current;
    progressBar.total = total;

    if (current >= total && !progressBar.completed) {
      progressBar.completed = true;

      // Remove after a brief delay
      setTimeout(() => {
        this.progressBars.delete(id);
        this.render();
      }, 1000);
    }

    this.render();
  }

  /**
   * Render the split view display (throttled)
   */
  private render() {
    if (!this.isEnabled) return;

    const now = Date.now();
    const timeSinceLastRender = now - this.lastRenderTime;

    if (timeSinceLastRender < this.RENDER_THROTTLE_MS) {
      // Schedule a render after throttle period expires
      // Don't reschedule if already pending - let it fire as scheduled
      if (!this.pendingRender) {
        this.pendingRender = setTimeout(() => {
          this.pendingRender = null;
          this.renderNow();
        }, this.RENDER_THROTTLE_MS - timeSinceLastRender);
      }
      return;
    }
    this.renderNow();
  }

  /**
   * Force an immediate render, bypassing throttle.
   * Use this sparingly - it's meant for ensuring UI updates during long operations.
   */
  forceRender() {
    if (!this.isEnabled) return;
    if (this.pendingRender) {
      clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }
    this.renderNow();
  }

  private renderNow() {
    if (!this.isEnabled) return;
    this.lastRenderTime = Date.now();
    this.hasNewLogs = false;

    // Calculate display height: at least MIN_HEIGHT, grows with number of progress bars
    const numProgressBars = this.progressBars.size;
    const height = Math.max(this.MIN_HEIGHT, numProgressBars > 0 ? numProgressBars : this.MIN_HEIGHT);

    // Clear previous render if this is not the first render
    if (this.currentHeight > 0) {
      // Move cursor to start of the display area
      readline.moveCursor(process.stdout, 0, -this.currentHeight);
      // Clear from cursor to end of screen
      readline.clearScreenDown(process.stdout);
    }

    // Get terminal width
    const termWidth = process.stdout.columns || 120;
    const leftWidth = Math.floor(termWidth * 0.6); // 60% for logs
    const rightWidth = termWidth - leftWidth - 3; // 40% for progress, -3 for borders

    // Trim logs array to prevent unbounded growth (keep last 1000 logs)
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }

    // Get recent logs to fill left side
    const recentLogs = this.logs.slice(-height);

    // Get all progress bars (display grows to fit them)
    const allProgressBars = Array.from(this.progressBars.values());

    // Render each line
    for (let i = 0; i < height; i++) {
      // Left side: log line
      const logLine = recentLogs[i] || '';
      const truncatedLog = logLine.length > leftWidth - 2
        ? logLine.substring(0, leftWidth - 5) + '...'
        : logLine;
      const paddedLog = truncatedLog.padEnd(leftWidth - 1);

      // Right side: progress bar
      let rightSide = '';

      if (i < allProgressBars.length) {
        const bar = allProgressBars[i];
        rightSide = this.formatProgressBar(bar, rightWidth);
      } else {
        rightSide = ''.padEnd(rightWidth);
      }

      // Combine with separator
      process.stdout.write(`${paddedLog} │ ${rightSide}\n`);
    }

    this.currentHeight = height;
  }

  /**
   * Format a single progress bar
   */
  private formatProgressBar(bar: ProgressBar, width: number): string {
    const percentage = bar.total > 0 ? Math.floor((bar.current / bar.total) * 100) : 0;

    const status = bar.completed ? '✓' : '▶';
    const counts = `${bar.current}/${bar.total}`;
    const percentStr = `${percentage}%`;

    // Fixed components: "▶ " + " [" + "] " + "99% " + counts
    const fixedWidth = 2 + 2 + 2 + percentStr.length + 1 + counts.length;

    // Available space for label and bar
    const availableSpace = Math.max(20, width - fixedWidth);
    const labelMaxWidth = Math.floor(availableSpace * 0.3); // 30% for label
    const barWidth = Math.max(8, availableSpace - labelMaxWidth - 1); // Rest for bar, -1 for spacing

    const truncatedLabel = bar.label.length > labelMaxWidth
      ? bar.label.substring(0, labelMaxWidth - 3) + '...'
      : bar.label;

    const filled = Math.floor((percentage / 100) * barWidth);
    const empty = barWidth - filled;
    const barChars = '█'.repeat(filled) + '░'.repeat(empty);

    const result = `${status} ${truncatedLabel.padEnd(labelMaxWidth)} [${barChars}] ${percentStr} ${counts}`;

    // Truncate if still too long (shouldn't happen, but safety check)
    return result.length > width ? result.substring(0, width - 3) + '...' : result;
  }

  /**
   * Cleanup on error - restore console without success message
   */
  cleanup() {
    if (!this.isEnabled) return;

    // Clear any pending render
    if (this.pendingRender) {
      clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }

    // Move cursor below the display
    if (this.currentHeight > 0) {
      process.stdout.write('\n');
    }

    // Show cursor again
    process.stdout.write('\x1B[?25h');

    // Restore console
    this.restoreConsole();
  }

  /**
   * Final render and cleanup
   */
  finish() {
    if (!this.isEnabled) return;

    // Clear any pending render
    if (this.pendingRender) {
      clearTimeout(this.pendingRender);
      this.pendingRender = null;
    }

    // Clear progress bars
    this.progressBars.clear();
    this.renderNow();

    // Move cursor below the display
    if (this.currentHeight > 0) {
      process.stdout.write('\n');
    }

    // Show cursor again
    process.stdout.write('\x1B[?25h');

    // Restore console before final message
    this.restoreConsole();
    console.log('✓ All tasks complete');
  }
}

// Singleton instance
let displayInstance: ProgressDisplay | null = null;

export function getProgressDisplay(): ProgressDisplay {
  if (!displayInstance) {
    displayInstance = new ProgressDisplay();
  }
  return displayInstance;
}

export function enableProgress() {
  getProgressDisplay().enable();
}
