/**
 * Cleanup Job
 *
 * Deletes meeting participant records older than 1 year.
 * Triggered monthly by Cloud Scheduler.
 */

import type { Request, Response } from '@google-cloud/functions-framework';
import { deleteOldRecords } from './utils/firestore.js';

// Data retention period: 365 days
const RETENTION_DAYS = 365;

/**
 * Handle cleanup request
 */
export async function handleCleanup(req: Request, res: Response): Promise<void> {
  // This endpoint is protected by IAM (--no-allow-unauthenticated)
  // Only Cloud Scheduler with proper service account can invoke it

  console.log('Starting cleanup job');

  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  console.log(`Deleting records older than: ${cutoffDate.toISOString()}`);

  try {
    const deletedCount = await deleteOldRecords(cutoffDate);

    console.log(`Cleanup complete. Deleted ${deletedCount} records.`);
    res.json({
      success: true,
      deleted: deletedCount,
      cutoff_date: cutoffDate.toISOString(),
    });
  } catch (error) {
    console.error('Cleanup failed:', error);
    res.status(500).json({ error: 'Cleanup failed' });
  }
}
