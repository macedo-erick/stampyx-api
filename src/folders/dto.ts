import { z } from 'zod';

export const FOLDER_SEPARATOR = '/';

const folderName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !value.includes('/') && !value.includes('\\'), {
    message: 'must not contain a path separator',
  })
  .refine((value) => !Array.from(value).some(isUnsafe), {
    message: 'must not contain control characters or IMAP wildcards',
  });

function isUnsafe(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;

  return code < 0x20 || code === 0x7f || character === '%' || character === '*';
}

const parentPath = z.string().trim().max(240).optional();

export const createFolderSchema = z.object({ name: folderName, parent: parentPath });
export type CreateFolderRequest = z.infer<typeof createFolderSchema>;

export const renameFolderSchema = z.object({ name: folderName });
export type RenameFolderRequest = z.infer<typeof renameFolderSchema>;

export interface FolderResponse {
  readonly path: string;
  readonly name: string;
  readonly parent: string | null;
  readonly total: number;
  readonly unread: number;
  readonly system: boolean;
  readonly specialUse: string | null;
  readonly ruleCount: number;
}

const path = z.string().trim().min(1).max(255);

export const renameFolderBodySchema = renameFolderSchema.extend({ path });
export type RenameFolderBody = z.infer<typeof renameFolderBodySchema>;

export const deleteFolderSchema = z.object({ path });
export type DeleteFolderBody = z.infer<typeof deleteFolderSchema>;
