import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { CONFIG, type Config } from '../config';
import type { FolderRule } from '../database/schema';
import { generateSieve } from './sieve';

const run = promisify(execFile);

export interface SieveTarget {
  readonly domainName: string;
  readonly localPart: string;
}

@Injectable()
export class SieveWriter {
  private readonly logger = new Logger(SieveWriter.name);

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async isCurrent(target: SieveTarget, rules: readonly FolderRule[]): Promise<boolean> {
    try {
      const onDisk = await readFile(this.pathFor(target), 'utf8');

      return onDisk === this.scriptFor(rules);
    } catch {
      return false;
    }
  }

  private scriptFor(rules: readonly FolderRule[]): string {
    return generateSieve(rules, { notifyScript: 'notify-mail-received.sh' });
  }

  pathFor(target: SieveTarget): string {
    return path.join(this.config.MAIL_SIEVE_DIR, target.domainName, `${target.localPart}.sieve`);
  }

  async write(target: SieveTarget, rules: readonly FolderRule[]): Promise<void> {
    const dir = path.join(this.config.MAIL_SIEVE_DIR, target.domainName);
    const file = path.join(dir, `${target.localPart}.sieve`);
    const script = this.scriptFor(rules);

    await mkdir(dir, { recursive: true });

    const staging = `${file}.staged`;
    await writeFile(staging, script, 'utf8');
    await this.compile(staging);
    await rename(staging, file);
  }

  private async compile(file: string): Promise<void> {
    try {
      await run('sievec', [file]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (isUnavailable(reason)) {
        this.logger.warn(
          `sievec unavailable here, leaving ${file} for Dovecot to compile: ${reason}`,
        );

        return;
      }

      this.logger.error(`sievec rejected ${file}: ${reason}`);

      throw error;
    }
  }
}

function isUnavailable(reason: string): boolean {
  return (
    reason.includes('ENOENT') ||
    reason.includes('not found') ||
    reason.includes('Failed to read configuration')
  );
}
