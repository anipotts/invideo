#!/usr/bin/env npx tsx
/**
 * Video discovery: scans YouTube channels from the channel registry via yt-dlp,
 * applies tier-specific filtering (keywords, view count, date), and outputs
 * a video manifest JSON for downstream batch processing.
 *
 * Usage:
 *   npx tsx scripts/discover-videos.ts [--tier 1|2|3|4|all] [--dry-run]
 *   npx tsx scripts/discover-videos.ts --channels "3Blue1Brown,Khan Academy,NeetCode,Fireship"
 *   npx tsx scripts/discover-videos.ts --channels "3Blue1Brown,Fireship" --all-videos
 *   npx tsx scripts/discover-videos.ts --channels "Khan Academy" --max-videos 500
 *
 * Output: scripts/video-manifest.json
 */

process.loadEnvFile('.env.local');

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { CHANNEL_REGISTRY } from '../lib/batch/channel-registry';
import type { ChannelConfig, VideoManifestEntry } from '../lib/batch/types';

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

function parseArgs(): { tier: 1 | 2 | 3 | 4 | 'all'; dryRun: boolean; channels: string[] | null; maxVideos: number | null } {
  const args = process.argv.slice(2);
  let tier: 1 | 2 | 3 | 4 | 'all' = 'all';
  let dryRun = false;
  let channels: string[] | null = null;
  let maxVideos: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' && args[i + 1]) {
      const val = args[i + 1];
      if (val === 'all') {
        tier = 'all';
      } else {
        const num = parseInt(val, 10);
        if (num >= 1 && num <= 4) {
          tier = num as 1 | 2 | 3 | 4;
        } else {
          console.error(`Invalid tier: ${val}. Must be 1, 2, 3, 4, or all.`);
          process.exit(1);
        }
      }
      i++;
    } else if (args[i] === '--channels' && args[i + 1]) {
      channels = args[i + 1].split(',').map(s => s.trim().toLowerCase());
      i++;
    } else if (args[i] === '--max-videos' && args[i + 1]) {
      maxVideos = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--all-videos') {
      maxVideos = -1; // sentinel: unlimited
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { tier, dryRun, channels, maxVideos };
}

// ─── yt-dlp JSON Line Interface ─────────────────────────────────────────────

interface YtDlpFlatEntry {
  id: string;
  title: string;
  view_count?: number;
  upload_date?: string;   // "YYYYMMDD"
  duration?: number;       // seconds
}

// ─── Cost Estimation ────────────────────────────────────────────────────────

// Rough per-video extraction cost in cents (Sonnet for most, Opus for tier 1)
const COST_PER_VIDEO_CENTS: Record<1 | 2 | 3 | 4, number> = {
  1: 109,  // Opus
  2: 16,   // Sonnet
  3: 16,
  4: 16,
};

// ─── Channel Discovery ──────────────────────────────────────────────────────

/** Default --dateafter for tier 4 channels to avoid fetching thousands of old videos */
const TIER4_DATE_AFTER = '20180101';

function discoverChannel(channel: ChannelConfig, maxVideosOverride?: number | null): VideoManifestEntry[] {
  const url = `https://www.youtube.com/channel/${channel.id}/videos`;
  const dateAfterFlag = channel.tier === 4 ? ` --dateafter ${TIER4_DATE_AFTER}` : '';
  const cmd = `yt-dlp --flat-playlist --dump-json${dateAfterFlag} "${url}"`;

  const effectiveMax = maxVideosOverride === -1 ? null : (maxVideosOverride ?? channel.maxVideos);
  console.log(`  Fetching ${channel.name} (tier ${channel.tier}, max: ${effectiveMax ?? 'all'})...`);

  let output: string;
  try {
    output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large channels
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR fetching ${channel.name}: ${message}`);
    return [];
  }

  // Parse JSON lines
  const lines = output.split('\n').filter(line => line.trim().length > 0);
  const entries: YtDlpFlatEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as YtDlpFlatEntry);
    } catch {
      // Skip malformed lines
    }
  }

  console.log(`    Raw videos found: ${entries.length}`);

  // Build forceInclude set
  const forceSet = new Set(channel.forceInclude ?? []);

  // Apply keyword filtering
  let filtered: YtDlpFlatEntry[];
  if (channel.keywords && channel.keywords.length > 0) {
    const keywordsLower = channel.keywords.map(k => k.toLowerCase());
    filtered = entries.filter(entry => {
      // Always include force-included IDs
      if (forceSet.has(entry.id)) return true;
      // Check if title matches any keyword
      const titleLower = entry.title.toLowerCase();
      return keywordsLower.some(kw => titleLower.includes(kw));
    });
    console.log(`    After keyword filter: ${filtered.length}`);
  } else {
    filtered = entries.map(entry => entry); // shallow copy
    // Still include forceInclude IDs (they should already be in the list)
  }

  // Sort by view_count descending
  filtered.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));

  // Apply maxVideos cap (null = unlimited)
  if (effectiveMax !== null && filtered.length > effectiveMax) {
    // Ensure forceInclude videos survive the cap
    const forced = filtered.filter(e => forceSet.has(e.id));
    const rest = filtered.filter(e => !forceSet.has(e.id));
    const remaining = Math.max(0, effectiveMax - forced.length);
    filtered = [...forced, ...rest.slice(0, remaining)];
    console.log(`    After maxVideos cap (${effectiveMax}): ${filtered.length}`);
  }

  // Convert to VideoManifestEntry
  return filtered.map(entry => ({
    videoId: entry.id,
    channelId: channel.id,
    channelName: channel.name,
    title: entry.title,
    tier: channel.tier,
    viewCount: entry.view_count,
    durationSeconds: entry.duration,
    uploadDate: entry.upload_date
      ? `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`
      : undefined,
    thumbnailUrl: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
  }));
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const { tier, dryRun, channels: channelFilter, maxVideos: maxVideosOverride } = parseArgs();

  console.log(`\n=== Chalk Video Discovery ===`);
  console.log(`Tier filter: ${tier}`);
  if (channelFilter) console.log(`Channel filter: ${channelFilter.join(', ')}`);
  if (maxVideosOverride) console.log(`Max videos override: ${maxVideosOverride === -1 ? 'unlimited' : maxVideosOverride}`);
  console.log(`Dry run: ${dryRun}\n`);

  // Select channels to process
  let channels: ChannelConfig[];
  if (channelFilter) {
    // --channels overrides --tier: find matching channels by name (case-insensitive)
    channels = CHANNEL_REGISTRY.filter(c =>
      channelFilter.some(f => c.name.toLowerCase().includes(f))
    );
    if (channels.length === 0) {
      console.error('No channels matched the filter. Available channels:');
      for (const c of CHANNEL_REGISTRY) console.error(`  ${c.name} (tier ${c.tier})`);
      process.exit(1);
    }
  } else {
    channels = tier === 'all'
      ? CHANNEL_REGISTRY
      : CHANNEL_REGISTRY.filter(c => c.tier === tier);
  }

  console.log(`Channels to scan: ${channels.length}\n`);

  const allEntries: VideoManifestEntry[] = [];
  const stats: Array<{ channel: string; tier: number; raw: number; filtered: number }> = [];

  for (const channel of channels) {
    const before = allEntries.length;
    const entries = discoverChannel(channel, maxVideosOverride);
    allEntries.push(...entries);
    stats.push({
      channel: channel.name,
      tier: channel.tier,
      raw: entries.length, // This is already the filtered count from discoverChannel
      filtered: entries.length,
    });
    console.log('');
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  console.log('=== Discovery Summary ===\n');

  // Group by tier
  const tierGroups = new Map<number, typeof stats>();
  for (const s of stats) {
    if (!tierGroups.has(s.tier)) tierGroups.set(s.tier, []);
    tierGroups.get(s.tier)!.push(s);
  }

  let totalCostCents = 0;
  for (const [t, group] of [...tierGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const totalVideos = group.reduce((sum, g) => sum + g.filtered, 0);
    const costCents = totalVideos * COST_PER_VIDEO_CENTS[t as 1 | 2 | 3 | 4];
    totalCostCents += costCents;
    console.log(`Tier ${t}: ${group.length} channels, ${totalVideos} videos, ~$${(costCents / 100).toFixed(2)}`);
    for (const s of group) {
      console.log(`  ${s.channel}: ${s.filtered} videos`);
    }
  }

  console.log(`\nTotal: ${allEntries.length} videos`);
  console.log(`Estimated extraction cost: ~$${(totalCostCents / 100).toFixed(2)}\n`);

  // ─── Write Output ───────────────────────────────────────────────────────

  if (dryRun) {
    console.log('Dry run — manifest not written.');
  } else {
    const outPath = join(process.cwd(), 'scripts', 'video-manifest.json');
    writeFileSync(outPath, JSON.stringify(allEntries, null, 2));
    console.log(`Manifest written to ${outPath}`);
    console.log(`Entries: ${allEntries.length}`);
  }
}

main();
