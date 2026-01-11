import * as vscode from 'vscode';

const USAGE_STORAGE_KEY = 'remoteServerManager.usageStats';

interface UsageStats {
  [hostKey: string]: {
    count: number;
    lastUsed: string;
    favorite?: boolean;
  };
}

/**
 * Service for tracking connection usage and favorites
 */
export class UsageTrackingService {
  private stats: UsageStats = {};

  constructor(private globalState: vscode.Memento) {
    this.loadStats();
  }

  /**
   * Load stats from storage
   */
  private loadStats(): void {
    this.stats = this.globalState.get<UsageStats>(USAGE_STORAGE_KEY, {});
  }

  /**
   * Save stats to storage
   */
  private async saveStats(): Promise<void> {
    await this.globalState.update(USAGE_STORAGE_KEY, this.stats);
  }

  /**
   * Generate a unique key for a host
   */
  private getHostKey(hostname: string, ip?: string): string {
    return ip ? `${hostname}::${ip}` : hostname;
  }

  /**
   * Record a connection to a host
   */
  async recordConnection(hostname: string, ip?: string): Promise<void> {
    const key = this.getHostKey(hostname, ip);

    if (!this.stats[key]) {
      this.stats[key] = {
        count: 0,
        lastUsed: new Date().toISOString(),
      };
    }

    this.stats[key].count++;
    this.stats[key].lastUsed = new Date().toISOString();

    await this.saveStats();
  }

  /**
   * Get connection count for a host
   */
  getConnectionCount(hostname: string, ip?: string): number {
    const key = this.getHostKey(hostname, ip);
    return this.stats[key]?.count || 0;
  }

  /**
   * Get last used date for a host
   */
  getLastUsed(hostname: string, ip?: string): Date | undefined {
    const key = this.getHostKey(hostname, ip);
    const lastUsed = this.stats[key]?.lastUsed;
    return lastUsed ? new Date(lastUsed) : undefined;
  }

  /**
   * Check if a host is a favorite
   */
  isFavorite(hostname: string, ip?: string): boolean {
    const key = this.getHostKey(hostname, ip);
    return this.stats[key]?.favorite || false;
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(hostname: string, ip?: string): Promise<boolean> {
    const key = this.getHostKey(hostname, ip);

    if (!this.stats[key]) {
      this.stats[key] = {
        count: 0,
        lastUsed: new Date().toISOString(),
        favorite: true,
      };
    } else {
      this.stats[key].favorite = !this.stats[key].favorite;
    }

    await this.saveStats();
    return this.stats[key].favorite!;
  }

  /**
   * Get top used hosts (sorted by count)
   */
  getTopUsedHosts(limit: number = 10): Array<{ key: string; count: number; lastUsed: Date }> {
    return Object.entries(this.stats)
      .filter(([, stat]) => stat.count > 0)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([key, stat]) => ({
        key,
        count: stat.count,
        lastUsed: new Date(stat.lastUsed),
      }));
  }

  /**
   * Get recently used hosts (sorted by last used)
   */
  getRecentlyUsedHosts(limit: number = 10): Array<{ key: string; count: number; lastUsed: Date }> {
    return Object.entries(this.stats)
      .filter(([, stat]) => stat.count > 0)
      .sort((a, b) => new Date(b[1].lastUsed).getTime() - new Date(a[1].lastUsed).getTime())
      .slice(0, limit)
      .map(([key, stat]) => ({
        key,
        count: stat.count,
        lastUsed: new Date(stat.lastUsed),
      }));
  }

  /**
   * Get favorite hosts
   */
  getFavoriteHostKeys(): string[] {
    return Object.entries(this.stats)
      .filter(([, stat]) => stat.favorite)
      .map(([key]) => key);
  }

  /**
   * Get usage score for sorting (favorites first, then by count)
   */
  getUsageScore(hostname: string, ip?: string): number {
    const key = this.getHostKey(hostname, ip);
    const stat = this.stats[key];

    if (!stat) {return 0;}

    // Favorites get a huge boost
    const favoriteBoost = stat.favorite ? 1000000 : 0;
    // Recent use gets a boost (within last 7 days)
    const recencyBoost = this.isRecentlyUsed(hostname, ip) ? 1000 : 0;

    return favoriteBoost + recencyBoost + stat.count;
  }

  /**
   * Check if host was used recently (within last 7 days)
   */
  isRecentlyUsed(hostname: string, ip?: string): boolean {
    const lastUsed = this.getLastUsed(hostname, ip);
    if (!lastUsed) {return false;}

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    return lastUsed > weekAgo;
  }

  /**
   * Clear all usage stats
   */
  async clearStats(): Promise<void> {
    this.stats = {};
    await this.saveStats();
  }
}
