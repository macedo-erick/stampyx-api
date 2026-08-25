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

  // Compares content, not existence: a fix to the generator has to reach mailboxes whose
  // script was written by the older one, and those are exactly the ones that already have a
  // file. Checking only for a missing file left every existing mailbox on the old script.
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

    // Write then rename: Dovecot may be reading the script while we replace it, and a
    // partially-written file would fail every delivery until the next edit. The staged copy
    // is compiled first, so a script that will not compile never reaches the live path.
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

      // sievec lives in the Dovecot image and reads Dovecot's config; in the API container
      // it either is missing or cannot find one. That is an environment fact, not a bad
      // script, and it must not fail a rule save - Dovecot compiles the script itself on
      // first delivery. Only a genuine rejection of the script is worth refusing over.
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
